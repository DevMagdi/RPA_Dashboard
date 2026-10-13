"""Refresh-token lifecycle: issuance, rotation, revocation, session listing.

Security model
--------------
* Access tokens are short lived (15 min, stateless JWTs).
* Refresh tokens are long lived but **stateful**: only a hash is stored, so a
  database leak does not yield usable tokens.
* Every refresh **rotates** the token (one-time use).  Presenting an already
  rotated token is treated as *token theft*: the entire session family for that
  user is revoked immediately and a critical audit event is written.
* Sessions are visible to the user (*"active devices"*) and revocable, which is
  a hard requirement for bank-grade deployments.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_refresh_token, token_hash
from app.db.dialect import get_flavor
from app.db.repository import execute, fetch_all, fetch_one, insert_row, update_rows
from app.db.session import session_scope
from app.db.tables import RefreshTokens

logger = logging.getLogger(__name__)


class TokenError(RuntimeError):
    """Raised for any invalid/expired/revoked refresh token."""


@dataclass
class IssuedToken:
    """A freshly minted refresh token."""

    raw_token: str
    token_id: int
    expires_at: datetime


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def issue_refresh_token(
    session: Session,
    *,
    user_id: int,
    
    username: str,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    expires_days: Optional[int] = None,
) -> IssuedToken:
    """Create and persist a new refresh token for a user session."""
    settings = get_settings()
    expires_at = _now() + timedelta(days=expires_days or settings.REFRESH_TOKEN_EXPIRE_DAYS)

    # The JWT carries the token id; we need the id *before* inserting, so the
    # row is inserted with a placeholder hash and updated right after — two
    # statements inside one transaction, invisible to callers.
    token_id = insert_row(
        session,
        RefreshTokens,
        {
            "UserID": user_id,
            "TokenHash": f"pending-{_now().timestamp()}",
            "ExpiresAt": expires_at,
            "IPAddress": (ip_address or "")[:64] or None,
            "UserAgent": (user_agent or "")[:400] or None,
        },
    )

    raw = create_refresh_token(
        username, user_id=user_id, token_id=str(token_id), expires_delta=timedelta(days=expires_days or settings.REFRESH_TOKEN_EXPIRE_DAYS)
    )
    update_rows(
        session,
        RefreshTokens,
        {"TokenHash": token_hash(raw, pepper="refresh")},
        [RefreshTokens.c.TokenID == token_id],
    )
    return IssuedToken(raw_token=raw, token_id=int(token_id), expires_at=expires_at)


def _fetch_token_row(session: Session, raw_token: str) -> Optional[Dict[str, Any]]:
    row = fetch_one(
        session,
        "SELECT * FROM RefreshTokens WHERE TokenHash = :h",
        {"h": token_hash(raw_token, pepper="refresh")},
        operation="token.lookup",
    )
    return row


def validate_refresh_token(session: Session, raw_token: str) -> Dict[str, Any]:
    """Validate a refresh token and return its row.

    Raises:
        TokenError: when missing, expired or revoked.
    """
    row = _fetch_token_row(session, raw_token)
    if not row:
        raise TokenError("refresh token not recognised")

    if row.get("RevokedAt"):
        # Reuse of a rotated token → assume compromise, burn the whole family.
        logger.critical("Refresh token reuse detected for user_id=%s — revoking all sessions", row.get("UserID"))
        revoke_all_for_user(
            session,
            user_id=int(row["UserID"]),
            
            reason="refresh_token_reuse_detected",
        )
        raise TokenError("refresh token already used — all sessions revoked for safety")

    expires_at = row.get("ExpiresAt")
    if isinstance(expires_at, datetime) and expires_at < _now():
        raise TokenError("refresh token expired")
    return row


def rotate_refresh_token(
    session: Session,
    raw_token: str,
    *,
    username: str,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> Tuple[IssuedToken, Dict[str, Any]]:
    """One-time-use rotation: revoke the presented token, issue a replacement."""
    current = validate_refresh_token(session, raw_token)

    issued = issue_refresh_token(
        session,
        user_id=int(current["UserID"]),
        
        username=username,
        ip_address=ip_address,
        user_agent=user_agent,
    )

    update_rows(
        session,
        RefreshTokens,
        {
            "RevokedAt": _now(),
            "RevokedReason": "rotated",
            "ReplacedByTokenID": issued.token_id,
            "LastUsedAt": _now(),
        },
        [RefreshTokens.c.TokenID == int(current["TokenID"])],
    )
    return issued, current


def revoke_token(session: Session, raw_token: str, *, reason: str = "logout") -> int:
    """Revoke a single refresh token (logout)."""
    row = _fetch_token_row(session, raw_token)
    if not row or row.get("RevokedAt"):
        return 0
    return update_rows(
        session,
        RefreshTokens,
        {"RevokedAt": _now(), "RevokedReason": reason[:200]},
        [RefreshTokens.c.TokenID == int(row["TokenID"])],
    )


def revoke_all_for_user(session: Session, *, user_id: int, reason: str = "revoke_all") -> int:
    """Revoke every active session of a user (panic button / password change)."""
    return update_rows(
        session,
        RefreshTokens,
        {"RevokedAt": _now(), "RevokedReason": reason[:200]},
        [
            RefreshTokens.c.UserID == user_id,
            RefreshTokens.c.RevokedAt.is_(None),
        ],
    )


def list_active_sessions(session: Session, *, user_id: int, limit: int = 50) -> List[Dict[str, Any]]:
    """Return the user's active sessions (for the *Security* screen)."""
    flavor = get_flavor()
    return fetch_all(
        session,
        f"""
        SELECT {flavor.top(int(limit))} TokenID, IPAddress, UserAgent, CreatedAt, ExpiresAt, LastUsedAt
        FROM RefreshTokens
        WHERE UserID = :u AND RevokedAt IS NULL AND ExpiresAt > {flavor.now()}
        ORDER BY CreatedAt DESC{flavor.limit(int(limit))}
        """,
        {"u": user_id},
        operation="token.sessions",
    )


def revoke_session_by_id(session: Session, *, user_id: int, token_id: int) -> int:
    """Remote-logout a specific device."""
    return update_rows(
        session,
        RefreshTokens,
        {"RevokedAt": _now(), "RevokedReason": "revoked_by_user"},
        [
            RefreshTokens.c.TokenID == token_id,
            RefreshTokens.c.UserID == user_id,
        ],
    )


def purge_expired(session: Session, *, older_than_days: int = 30) -> int:
    """Housekeeping: delete long-expired session rows (retention policy)."""
    flavor = get_flavor()
    return execute(
        session,
        f"DELETE FROM RefreshTokens WHERE ExpiresAt < {flavor.days_ago(older_than_days)}",
        operation="token.purge",
    )


def count_active_sessions(user_id: int) -> int:
    """Active session counter used by the dashboard security widget."""
    with session_scope() as session:
        row = fetch_one(
            session,
            "SELECT COUNT(1) AS c FROM RefreshTokens WHERE UserID = :u AND RevokedAt IS NULL",
            {"u": user_id},
            operation="token.count",
        )
    return int((row or {}).get("c") or 0)
