# RPA CoE Control Room 4.1.0 — "Private Operations"

Review guide for the 4.1.0 UX / Arabic / performance pass. Positioning: **single-tenant,
On-Premises only** — one installation serves one bank/large enterprise inside
its own data center or private cloud, as a vendor-neutral control plane over
UiPath, Automation Anywhere, Blue Prism and in-house RPA.

## Headline changes

0. **Decision-first dashboard (v5)** — the screen is now ordered by how fast an
   operator can act: hero **verdict** → **triage queue** → **health board** →
   analytics. `lib/opsSignals.js` (pure, testable) derives one verdict + ranked
   action list from the real payload, so the three tiers cannot disagree.
   Failed runs, SLA breaches, open alerts and runner-less queues — all of which
   were already in the payload but never ranked or actionable — now appear at the
   top with the action that resolves them. No colour or token changed.
1. **Single-organization model** — the multi-organization tenancy layer was
   removed end to end: one seeded `Organization`, no discriminator columns,
   JWTs carry user/department only, and organization administration is guarded
   by `require_organization_admin`.
2. **Security P0s closed** — production refuses to start without `FERNET_KEY`;
   TrustedHost/ProxyHeaders are env-driven; agent WebSocket tokens travel in
   headers/subprotocols only (never query strings); token revocation
   force-disconnects the live agent socket; 12-char password policy with
   history and SHA-256 pre-hashing (no bcrypt truncation); every vault
   decryption is audited with a mandatory reason.
3. **Real operations** — run ingestion (`/api/runs/start|heartbeat|complete`),
   queue telemetry snapshots, signed agent command & control (whitelist +
   HMAC + scheduling) where the agent actually starts/stops bots, and an
   alerting engine (agent offline, SLA risk, failure rate, repeated failure)
   with dedupe/cooldown and SMTP/Teams/Slack delivery.
4. **Governance** — strict Dev → UAT → Prod state machine, four-eyes
   Production approval, target-environment secret checks, rollback.
5. **Product completeness** — Arabic + English + RTL UI, alerts bell with
   open-count, organization settings page, production Dockerfile/compose,
   Windows Service scripts, and `docs/DEPLOYMENT_ON_PREM_BANK.md`.
6. **Quality** — pytest suite with an 80% coverage gate; CI runs ruff,
   frontend lint/build, pip-audit/npm audit and gitleaks.

## How to review

- `README.md` (positioning, run, deploy) · `CHANGELOG.md` (4.1.0 entry)
- `docs/DEPLOYMENT_ON_PREM_BANK.md` (bank runbook) · `docs/adr/ADR-002-*`
- Diff by phase: data model → security → ingestion/commands/alerts →
  frontend → ops/CI.
