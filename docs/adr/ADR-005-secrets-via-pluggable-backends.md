# ADR-005: Secrets via pluggable backends, never in git or the tenant blob

- **Status:** Accepted (3.0.0)
- **Date:** 2026-10-13

## Context
Vendor credentials and platform secrets must never be committed, nor stored
in clear text in the tenant configuration JSON.

## Decision
`app/core/secrets.py` defines a `SecretStore` abstraction with env, Azure Key
Vault and HashiCorp Vault backends (plus an in-process caching wrapper).
Tenant platform configs store `vault:NAME` references only; the registry
resolves them at adapter-build time and never writes resolved values back.
Bot credentials live in a Fernet-encrypted vault (`FERNET_KEY`), with key
rotation support. `.env.example` documents all 80 settings; real values are
injected by the deployment platform.

## Consequences
- Zero code change between a bank's on-prem vault and a cloud Key Vault.
- A test asserts `.env.example` covers every `Settings` field exactly, so new
  settings cannot ship undocumented.
