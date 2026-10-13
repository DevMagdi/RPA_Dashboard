"""Security primitives: passwords, JWT, TOTP, backup codes, vault cipher."""

from __future__ import annotations

from datetime import timedelta

import jwt
import pytest

from app.core.security import (
    build_totp_uri,
    check_password_policy,
    constant_time_equals,
    consume_backup_code,
    create_access_token,
    create_refresh_token,
    csrf_tokens_match,
    decode_token,
    generate_backup_codes,
    generate_csrf_token,
    generate_totp_secret,
    get_vault_cipher,
    hash_backup_code,
    hash_password,
    looks_like_sha256_hex,
    mask_secret,
    token_hash,
    verify_password,
    verify_totp,
)


def test_password_hash_roundtrip():
    hashed = hash_password("Str0ng_Passw0rd!")
    assert hashed != "Str0ng_Passw0rd!"
    assert verify_password("Str0ng_Passw0rd!", hashed)
    assert not verify_password("wrong-password", hashed)


def test_verify_password_rejects_empty_hash():
    assert not verify_password("anything", "")


@pytest.mark.parametrize(
    "password,ok",
    [
        ("Str0ng_Passw0rd!", True),
        ("short", False),
        ("alllowercase", False),          # single character class
        ("abcdefgh1234", False),          # only two classes
        ("alllowercase123!", True),       # three classes: lower+digit+punct
        ("NoSpecial12345", True),         # three classes: upper+lower+digit
    ],
)
def test_password_policy(password, ok):
    result = check_password_policy(password, min_length=8)
    assert result.ok is ok


def test_access_token_claims():
    token = create_access_token("alice", role="Operator", user_id=7, department="Finance")
    payload = decode_token(token, expected_type="access")
    assert payload["sub"] == "alice"
    assert payload["role"] == "Operator"
    assert payload["user_id"] == 7
    assert payload["user_id"] == 7
    assert payload["department"] == "Finance"


def test_refresh_token_type_enforced():
    token = create_refresh_token("alice", user_id=7, token_id="tok-1")
    with pytest.raises(jwt.InvalidTokenError):
        decode_token(token, expected_type="access")


def test_expired_token_rejected():
    token = create_access_token(
        "alice", role="Viewer", user_id=1, expires_delta=timedelta(seconds=-10)
    )
    with pytest.raises(jwt.PyJWTError):
        decode_token(token)


def test_tampered_token_rejected():
    token = create_access_token("alice", role="Viewer", user_id=1)
    with pytest.raises(jwt.PyJWTError):
        decode_token(token + "tampered")


def test_token_hash_deterministic_and_peppered():
    assert token_hash("abc") == token_hash("abc")
    assert token_hash("abc", pepper="one") != token_hash("abc", pepper="two")
    assert looks_like_sha256_hex(token_hash("abc"))
    assert not looks_like_sha256_hex("not-a-hash")


def test_constant_time_equals():
    assert constant_time_equals("same", "same")
    assert not constant_time_equals("same", "diff")


def test_csrf_tokens():
    token = generate_csrf_token()
    assert csrf_tokens_match(token, token)
    assert not csrf_tokens_match(token, "forged")
    assert not csrf_tokens_match(None, token)


def test_totp_roundtrip():
    import pyotp

    secret = generate_totp_secret()
    assert verify_totp(secret, pyotp.TOTP(secret).now())
    assert not verify_totp(secret, "000000")


def test_totp_uri_contains_issuer_and_account():
    uri = build_totp_uri(generate_totp_secret(), "alice@bank", issuer="Control Room")
    assert uri.startswith("otpauth://totp/")
    assert "alice" in uri


def test_backup_codes_single_use_consumption():
    codes = generate_backup_codes(5)
    assert len(codes) == 5
    hashed = [hash_backup_code(c) for c in codes]
    matched = consume_backup_code(codes[0], hashed)
    assert matched == hashed[0]
    assert consume_backup_code("XXXX-XXXX", hashed) is None


def test_vault_cipher_roundtrip():
    cipher = get_vault_cipher()
    encrypted = cipher.encrypt("s3cr3t-value")
    assert encrypted != "s3cr3t-value"
    assert cipher.decrypt(encrypted) == "s3cr3t-value"


def test_mask_secret():
    assert mask_secret("abcdefghij") == "******ghij"
    assert mask_secret(None) == ""
    assert mask_secret("ab") == "**"
