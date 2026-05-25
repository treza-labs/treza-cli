# Treza Redaction Proxy — MVP Build Spec

The canonical build spec for the `treza redact` command group lives in the `treza-docs` repo:

**[treza-docs/internal/redaction-mvp-plan.md](https://github.com/treza-labs/treza-docs/blob/main/internal/redaction-mvp-plan.md)**

Touches three repos:

- `treza-cli` — the developer-facing CLI surface (`redact run`, `redact proxy`, `redact log`, `redact trial`)
- `treza-app` — control plane (`/api/redact/*` routes + DynamoDB tables + Nitro enclave image)
- the hosted enclave deployment itself

Refer to the canonical spec for the full architecture, two-mode (TEE vs `--local`) design, control-plane API surface, and work breakdown.
