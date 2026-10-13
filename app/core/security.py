"""Cryptographic primitives and token handling.

Responsibilities
----------------
* password hashing / verification (bcrypt, consistent 72-byte handling)
* password policy enforcement
* JWT access-token creation & decoding (short lived, 15 min by default)
* TOTP (MFA) secret generation, provisioning URI and verification
* backup-code generation / hashing
* CSRF token generation and validation helpers

Everything here is pure and side-effect free so it can be unit-tested without
a database or HTTP layer.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import secrets
import string
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, Optional, Sequence

import bcrypt
import jwt
import pyotp
from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #
ALGORITHM = "HS256"
BCRYPT_ROUNDS = 12
_BCRYPT_MAX_BYTES = 72  # bcrypt silently truncates beyond this

COMMON_PASSWORDS = {
    "password",
    "password1",
    "password123",
    "123456",
    "12345678",
    "123456789",
    "qwerty",
    "qwerty123",
    "admin",
    "admin123",
    "letmein",
    "welcome",
    "welcome1",
    "p@ssw0rd",
    "passw0rd",
    "iloveyou",
    "monkey",
    "dragon",
    "changeme",
    "rpa123456",
    "bank1234",
    "test1234",
}


# --------------------------------------------------------------------------- #
# Passwords
# --------------------------------------------------------------------------- #
def _pw_bytes(password: str) -> bytes:
    """Pre-hash with SHA-256 (base64) so bcrypt never truncates.

    bcrypt silently truncates inputs beyond 72 bytes, which would make two
    different long passwords compare equal. Hashing first with SHA-256 and
    base64-encoding the digest (44 bytes) gives bcrypt a fixed-size,
    high-entropy input. Legacy hashes (direct bcrypt of the raw password)
    are still verified by :func:`verify_password` as a fallback.
    """
    import base64 as _b64
    import hashlib as _hl

    return _b64.b64encode(_hl.sha256(password.encode("utf-8")).digest())


def _pw_bytes_legacy(password: str) -> bytes:
    """Legacy direct encoding (pre-4.0 hashes), truncation included."""
    return password.encode("utf-8")[:_BCRYPT_MAX_BYTES]


def hash_password(password: str) -> str:
    """Return a bcrypt hash for ``password``."""
    return bcrypt.hashpw(_pw_bytes(password), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    """Constant-time verification of ``password`` against ``hashed``."""
    if not hashed:
        return False
    try:
        if bcrypt.checkpw(_pw_bytes(password), hashed.encode("utf-8")):
            return True
    except (ValueError, TypeError):
        return False
    try:
        # Legacy fallback: hashes created before the SHA-256 pre-hash (<=3.x).
        return bcrypt.checkpw(_pw_bytes_legacy(password), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def hash_needs_rehash(hashed: str) -> bool:
    """True when the stored hash uses weaker parameters than the current policy."""
    try:
        rounds = int(hashed.split("$")[2])
    except (IndexError, ValueError):
        return True
    return rounds < BCRYPT_ROUNDS


@dataclass(frozen=True)
class PasswordPolicyResult:
    """Outcome of :func:`check_password_policy`."""

    ok: bool
    errors: Sequence[str]

    @property
    def message(self) -> str:
        return "; ".join(self.errors)


def check_password_policy(password: str, *, min_length: Optional[int] = None) -> PasswordPolicyResult:
    """Validate a password against the platform policy.

    Policy: minimum length (config, 12 by default), at least three of four character classes,
    and not present in a small list of well-known weak passwords.
    """
    settings = get_settings()
    minimum = min_length or settings.PASSWORD_MIN_LENGTH
    errors: list[str] = []

    if len(password or "") < minimum:
        errors.append(f"كلمة المرور يجب أن تكون {minimum} حرف على الأقل")
    if len(password or "") > 256:
        errors.append("كلمة المرور طويلة جدًا")

    classes = sum(
        [
            any(c.islower() for c in password or ""),
            any(c.isupper() for c in password or ""),
            any(c.isdigit() for c in password or ""),
            any(c in string.punctuation for c in password or ""),
        ]
    )
    if classes < 3:
        errors.append("كلمة المرور يجب أن تحتوي على 3 أنواع مختلفة على الأقل (حروف كبيرة/صغيرة/أرقام/رموز)")
    if (password or "").lower() in COMMON_PASSWORDS:
        errors.append("كلمة المرور شائعة جدًا وسهلة التخمين")

    return PasswordPolicyResult(ok=not errors, errors=errors)


# --------------------------------------------------------------------------- #
# JWT
# --------------------------------------------------------------------------- #
def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(
    subject: str,
    *,
    role: str,
    
    user_id: int,
    department: str = "ALL",
    expires_delta: Optional[timedelta] = None,
    extra_claims: Optional[Dict[str, Any]] = None,
) -> str:
    """Create a short-lived access token (default 15 minutes)."""
    settings = get_settings()
    expire = _now() + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    payload: Dict[str, Any] = {
        "sub": subject,
        "role": role,
        "user_id": user_id,
        "department": department,
        "type": "access",
        "iat": int(_now().timestamp()),
        "exp": int(expire.timestamp()),
        "jti": uuid.uuid4().hex,
        "iss": settings.APP_NAME,
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(
    subject: str,
    *,
    user_id: int,
    
    token_id: str,
    expires_delta: Optional[timedelta] = None,
) -> str:
    """Create a long-lived refresh token (rotated on every use)."""
    settings = get_settings()
    expire = _now() + (expires_delta or timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS))
    payload = {
        "sub": subject,
        "user_id": user_id,
        "jti": token_id,
        "type": "refresh",
        "iat": int(_now().timestamp()),
        "exp": int(expire.timestamp()),
        "iss": settings.APP_NAME,
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str, *, expected_type: Optional[str] = None) -> Dict[str, Any]:
    """Decode & validate a JWT.

    Raises:
        jwt.PyJWTError: when the token is invalid, expired or of the wrong type.
    """
    payload = jwt.decode(
        token,
        get_settings().JWT_SECRET_KEY,
        algorithms=[ALGORITHM],
        options={"verify_aud": False},
    )
    if expected_type and payload.get("type") != expected_type:
        raise jwt.InvalidTokenError(f"expected {expected_type} token")
    return payload


def token_hash(token: str, pepper: Optional[str] = None) -> str:
    """Deterministic HMAC-SHA256 hash used to store tokens at rest."""
    settings = get_settings()
    key = (pepper if pepper is not None else settings.AGENT_TOKEN_PEPPER) or ""
    if key:
        return hmac.new(key.encode("utf-8"), token.encode("utf-8"), hashlib.sha256).hexdigest()
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def looks_like_sha256_hex(value: Any) -> bool:
    """Heuristic used to detect already-hashed token columns."""
    if not isinstance(value, str) or len(value) != 64:
        return False
    try:
        int(value, 16)
        return True
    except ValueError:
        return False


def constant_time_equals(left: str, right: str) -> bool:
    """Timing-safe string comparison."""
    return hmac.compare_digest(left or "", right or "")


# --------------------------------------------------------------------------- #
# CSRF (double-submit cookie)
# --------------------------------------------------------------------------- #
CSRF_COOKIE_NAME = "csrf_token"
CSRF_HEADER_NAME = "X-CSRF-Token"
CSRF_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})


def generate_csrf_token() -> str:
    """Return a new opaque CSRF token."""
    return secrets.token_urlsafe(32)


def csrf_tokens_match(cookie_value: Optional[str], header_value: Optional[str]) -> bool:
    """Validate the double-submit pair."""
    if not cookie_value or not header_value:
        return False
    return constant_time_equals(cookie_value, header_value)


def generate_agent_token() -> str:
    """Opaque high-entropy token handed to a machine agent at enrollment."""
    return secrets.token_urlsafe(48)


def generate_enrollment_code(length: int = 8) -> str:
    """Human-friendly one-time enrollment code (``ABCD-2345``)."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    code = "".join(secrets.choice(alphabet) for _ in range(length))
    return f"{code[:4]}-{code[4:]}"


# --------------------------------------------------------------------------- #
# MFA / TOTP
# --------------------------------------------------------------------------- #
def generate_totp_secret() -> str:
    """Generate a new base32 TOTP secret."""
    return pyotp.random_base32()


def build_totp_uri(secret: str, account_name: str, issuer: Optional[str] = None) -> str:
    """Build the ``otpauth://`` provisioning URI consumed by authenticator apps."""
    settings = get_settings()
    return pyotp.TOTP(secret).provisioning_uri(
        name=account_name, issuer_name=issuer or settings.MFA_ISSUER
    )


def verify_totp(secret: str, code: str, *, window: Optional[int] = None) -> bool:
    """Verify a 6-digit TOTP code allowing a small clock drift window."""
    if not secret or not code:
        return False
    settings = get_settings()
    try:
        return pyotp.TOTP(secret).verify(str(code).strip().replace(" ", ""), valid_window=window or settings.MFA_WINDOW)
    except Exception:
        return False


def generate_backup_codes(count: Optional[int] = None) -> list[str]:
    """Generate one-time recovery codes (``XXXX-XXXX``)."""
    settings = get_settings()
    total = count or settings.MFA_BACKUP_CODES
    alphabet = string.ascii_uppercase + string.digits
    return [
        f"{''.join(secrets.choice(alphabet) for _ in range(4))}-{''.join(secrets.choice(alphabet) for _ in range(4))}"
        for _ in range(total)
    ]


def hash_backup_code(code: str) -> str:
    """Hash a backup code for storage (peppered SHA-256, case-insensitive)."""
    return token_hash(code.strip().upper().replace("-", ""))


def consume_backup_code(code: str, hashed_codes: Iterable[str]) -> Optional[str]:
    """Return the matching hashed code (the one to delete) or ``None``."""
    target = hash_backup_code(code)
    for stored in hashed_codes or []:
        if constant_time_equals(target, stored):
            return stored
    return None


# --------------------------------------------------------------------------- #
# Fernet (credential vault)
# --------------------------------------------------------------------------- #
class VaultCipher:
    """Symmetric cipher used for credentials stored in ``BotVault``.

    ``FERNET_KEY`` must be supplied in every environment: the original
    implementation generated an ephemeral key per process, which silently
    invalidated every stored secret on restart.
    """

    def __init__(self, keys: Optional[Sequence[str]] = None) -> None:
        from cryptography.fernet import MultiFernet

        settings = get_settings()
        raw_keys = list(keys or [k for k in (settings.FERNET_KEY or "").split(",") if k.strip()])
        if not raw_keys:
            raise RuntimeError(
                "FERNET_KEY is not configured — refusing to start. "
                "Generate one with: python -c \"from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())\""
            )
        self._multi = MultiFernet([Fernet(k.encode() if isinstance(k, str) else k) for k in raw_keys])

    def encrypt(self, plaintext: str) -> str:
        """Encrypt a UTF-8 string."""
        return self._multi.encrypt(plaintext.encode("utf-8")).decode("utf-8")

    def decrypt(self, token: str) -> str:
        """Decrypt a token produced by :meth:`encrypt`."""
        try:
            return self._multi.decrypt(token.encode("utf-8")).decode("utf-8")
        except InvalidToken as exc:
            raise ValueError("Unable to decrypt value (wrong or rotated FERNET_KEY)") from exc

    def rotate(self, token: str) -> str:
        """Re-encrypt with the newest key (used during key rotation)."""
        return self._multi.rotate(token.encode("utf-8")).decode("utf-8")


_cipher: Optional[VaultCipher] = None


def get_vault_cipher() -> VaultCipher:
    """Return the process-wide vault cipher (multi-key aware)."""
    global _cipher
    if _cipher is None:
        _cipher = VaultCipher()
    return _cipher


def reset_vault_cipher() -> None:
    """Reset the cached cipher — for tests / key rotation reloads."""
    global _cipher
    _cipher = None


def base64url_encode(raw: bytes) -> str:
    """URL-safe base64 without padding (used for backup code export)."""
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")


def mask_secret(value: Optional[str], visible: int = 4) -> str:
    """Mask a secret for logs / API responses (``****abcd``)."""
    if not value:
        return ""
    s = str(value)
    if len(s) <= visible:
        return "*" * len(s)
    return "*" * (len(s) - visible) + s[-visible:]


def redact(payload: Dict[str, Any], keys: Iterable[str]) -> Dict[str, Any]:
    """Return a copy of ``payload`` with sensitive keys masked (log safety)."""
    lower = {k.lower() for k in keys}
    return {k: ("***REDACTED***" if k.lower() in lower else v) for k, v in (payload or {}).items()}


def safe_json_dumps(payload: Any) -> Optional[str]:
    """JSON-serialise audit values without ever raising."""
    if payload is None:
        return None
    if isinstance(payload, str):
        return payload
    try:
        return json.dumps(payload, default=str, ensure_ascii=False)
    except Exception:  # pragma: no cover - defensive
        return None
