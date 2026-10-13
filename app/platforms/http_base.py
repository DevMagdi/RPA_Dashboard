"""Shared HTTP plumbing for vendor adapters.

Provides authentication strategies (OAuth2 client-credentials, api-key,
basic, static bearer), retry/backoff with jitter, timeout handling and
uniform error mapping — so individual adapters only deal with payloads.
"""

from __future__ import annotations

import logging
import random
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Literal, Optional, Tuple

import httpx

from app.platforms.base import PlatformAdapter

logger = logging.getLogger(__name__)

AuthMode = Literal["oauth_client_credentials", "api_key", "basic", "bearer", "none"]


class PlatformAuthError(RuntimeError):
    """Raised when the upstream platform rejects our credentials."""


class PlatformUnavailable(RuntimeError):
    """Raised when the upstream platform cannot be reached."""


@dataclass
class HttpAdapterConfig:
    """Configuration accepted by every HTTP-based adapter.

    Stored for the organization (``Organization.PlatformConfigJson``) and resolved through the
    configured secret store — never hard-coded, never committed.
    """

    # Empty default: adapters must be *instantiable* without credentials so the
    # provider catalogue / setup wizard can describe them before the organization has
    # configured anything (requests against an empty base URL fail fast with
    # PlatformUnavailable instead).
    base_url: str = ""
    auth_mode: AuthMode = "bearer"
    client_id: Optional[str] = None
    client_secret: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    api_key: Optional[str] = None
    token: Optional[str] = None
    token_url: Optional[str] = None
    verify_ssl: bool = True
    timeout: float = 20.0
    max_retries: int = 2
    # Vendor scoping headers
    workspace_name: Optional[str] = None
    organization_unit_id: Optional[str] = None
    folder_id: Optional[str] = None
    extra_headers: Dict[str, str] = field(default_factory=dict)
    extra: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "HttpAdapterConfig":
        """Build a config from the organization JSON blob (unknown keys → ``extra``)."""
        known = {f for f in cls.__dataclass_fields__}  # type: ignore[attr-defined]
        data = {k: v for k, v in (payload or {}).items() if k in known}
        extra = {k: v for k, v in (payload or {}).items() if k not in known}
        config = cls(**data)
        config.extra.update(extra)
        return config


class HttpPlatformAdapter(PlatformAdapter):
    """Base class for REST-based RPA platforms (UiPath, Automation Anywhere…)."""

    def __init__(self, config: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(config)
        self.http_config = HttpAdapterConfig.from_dict(config or {})
        self._token: Optional[str] = None
        self._token_expiry: float = 0.0
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ #
    # HTTP
    # ------------------------------------------------------------------ #
    def _client(self) -> httpx.Client:
        """Create a client honouring the TLS verification setting."""
        return httpx.Client(
            timeout=httpx.Timeout(self.http_config.timeout, connect=min(10.0, self.http_config.timeout)),
            verify=self.http_config.verify_ssl,
            follow_redirects=True,
        )

    def _auth_headers(self) -> Dict[str, str]:
        """Build authentication headers for the configured strategy."""
        cfg = self.http_config
        headers: Dict[str, str] = dict(cfg.extra_headers or {})

        if cfg.auth_mode == "oauth_client_credentials":
            token = self._oauth_token()
            if token:
                headers["Authorization"] = f"Bearer {token}"
        elif cfg.auth_mode == "api_key":
            if cfg.api_key:
                headers["Authorization"] = f"Bearer {cfg.api_key}"
        elif cfg.auth_mode == "bearer":
            if cfg.token:
                headers["Authorization"] = f"Bearer {cfg.token}"
        elif cfg.auth_mode == "basic":
            # httpx handles basic auth from the tuple
            pass

        # Vendor scoping headers (harmless when not needed)
        if cfg.workspace_name:
            headers.setdefault("X-UIPATH-OrganizationUnitId", cfg.workspace_name)
        if cfg.organization_unit_id:
            headers.setdefault("X-UIPATH-OrganizationUnitId", str(cfg.organization_unit_id))
        if cfg.folder_id:
            headers.setdefault("X-AA-Folder-Id", str(cfg.folder_id))
        return headers

    def _oauth_token(self) -> Optional[str]:
        """Fetch (and cache) an OAuth2 client-credentials token."""
        cfg = self.http_config
        with self._lock:
            now = time.time()
            if self._token and now < self._token_expiry - 30:
                return self._token

            token_url = cfg.token_url or f"{cfg.base_url.rstrip('/')}/connect/token"
            payload = {
                "grant_type": "client_credentials",
                "client_id": cfg.client_id or "",
                "client_secret": cfg.client_secret or "",
            }
            if cfg.extra.get("scope"):
                payload["scope"] = cfg.extra["scope"]

            try:
                with self._client() as client:
                    response = client.post(token_url, data=payload)
                if response.status_code >= 400:
                    raise PlatformAuthError(
                        f"{self.display_name} token request failed ({response.status_code}): {response.text[:200]}"
                    )
                body = response.json()
            except PlatformAuthError:
                raise
            except Exception as exc:
                raise PlatformUnavailable(f"{self.display_name} auth endpoint unreachable: {exc}") from exc

            self._token = body.get("access_token") or body.get("token")
            expires_in = float(body.get("expires_in") or 3600)
            self._token_expiry = now + expires_in
            return self._token

    def request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        json_body: Optional[Dict[str, Any]] = None,
        data: Optional[Dict[str, Any]] = None,
        expect_json: bool = True,
    ) -> Any:
        """Perform an authenticated request with retry/backoff.

        Retries on 429/5xx (respecting ``Retry-After`` when present) and on
        transient network errors.  4xx client errors are surfaced immediately
        with the vendor message so operators can act on them.
        """
        cfg = self.http_config
        url = path if path.startswith("http") else f"{cfg.base_url.rstrip('/')}/{path.lstrip('/')}"
        auth = None
        if cfg.auth_mode == "basic" and cfg.username:
            auth = (cfg.username, cfg.password or "")

        last_error: Optional[Exception] = None
        for attempt in range(max(0, cfg.max_retries) + 1):
            started = time.perf_counter()
            try:
                with self._client() as client:
                    response = client.request(
                        method.upper(),
                        url,
                        params=params,
                        json=json_body,
                        data=data,
                        headers=self._auth_headers(),
                        auth=auth,
                    )
                duration_ms = (time.perf_counter() - started) * 1000
                logger.debug(
                    "%s %s %s -> %s (%.0f ms)", self.name, method.upper(), url, response.status_code, duration_ms
                )

                if response.status_code in (401, 403):
                    raise PlatformAuthError(
                        f"{self.display_name} rejected the credentials ({response.status_code}): {response.text[:200]}"
                    )
                if response.status_code == 429 or response.status_code >= 500:
                    retry_after = float(response.headers.get("Retry-After") or 0) or (2**attempt) * 0.5
                    if attempt < cfg.max_retries:
                        time.sleep(min(retry_after, 10) + random.uniform(0, 0.4))
                        continue
                    raise PlatformUnavailable(
                        f"{self.display_name} unavailable ({response.status_code}): {response.text[:200]}"
                    )
                if response.status_code >= 400:
                    raise RuntimeError(
                        f"{self.display_name} request failed ({response.status_code}): {response.text[:300]}"
                    )
                if not expect_json:
                    return response
                if response.status_code == 204 or not response.content:
                    return {}
                return response.json()

            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last_error = exc
                if attempt < cfg.max_retries:
                    time.sleep((2**attempt) * 0.5 + random.uniform(0, 0.3))
                    continue
                raise PlatformUnavailable(f"{self.display_name} network error: {exc}") from exc

        raise PlatformUnavailable(f"{self.display_name} request failed after retries: {last_error}")

    # ------------------------------------------------------------------ #
    # Helpers shared by vendor adapters
    # ------------------------------------------------------------------ #
    @staticmethod
    def unwrap_list(payload: Any, *keys: str) -> list:
        """Extract the item list from vendor envelopes (``value``/``data``…)."""
        if isinstance(payload, list):
            return payload
        if isinstance(payload, dict):
            for key in keys or ("value", "data", "items", "results", "content"):
                value = payload.get(key)
                if isinstance(value, list):
                    return value
                if isinstance(value, dict):
                    for nested in ("value", "data", "items", "results"):
                        if isinstance(value.get(nested), list):
                            return value[nested]
        return []

    def test_connection(self) -> Tuple[bool, str]:
        """Ping the vendor and return ``(ok, human readable message)``."""
        try:
            health = self.health()
            return health.ok, health.message
        except PlatformAuthError as exc:
            return False, str(exc)
        except Exception as exc:  # pragma: no cover - network dependent
            return False, str(exc)[:200]
