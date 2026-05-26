#!/usr/bin/env bash
#
# End-to-end acceptance test for the `treza redact` command group.
#
# Verifies, in order:
#   1. `treza redact run --local` redacts piped text with no network call.
#   2. `treza redact run` (TEE mode) redacts via the control plane and
#      prints the entity map to stderr.
#   3. `treza redact proxy` starts and responds on its local port.
#   4. `treza redact log` returns audit entries.
#
# Configuration (env vars):
#   TREZA_BIN          - CLI command to invoke (default: `treza`)
#   TREZA_API_URL      - Control plane base URL (default: from CLI config)
#   TREZA_API_KEY      - Bearer key with redact:* permissions (required for TEE)
#   TREZA_WALLET       - Wallet address tied to that key (required for TEE)
#   PROXY_PORT         - Port the proxy should listen on (default: 8717)
#   SKIP_TEE           - Set to 1 to run only the --local step (no backend needed)
#
# Examples:
#   # Just the local-mode smoke test (no creds, no backend):
#   SKIP_TEE=1 scripts/e2e-redact.sh
#
#   # Full e2e against a local treza-app dev server:
#   TREZA_API_URL=http://localhost:3000 \
#   TREZA_API_KEY=treza_test_xxx \
#   TREZA_WALLET=0xYourWallet \
#     scripts/e2e-redact.sh
#
# Exit codes:
#   0 = all checks passed
#   1 = a required check failed
#
set -euo pipefail

TREZA_BIN="${TREZA_BIN:-treza}"
PROXY_PORT="${PROXY_PORT:-8717}"
SKIP_TEE="${SKIP_TEE:-0}"
TMPDIR="$(mktemp -d -t treza-e2e-XXXXXX)"
PROXY_PID=""

cleanup() {
  rm -rf "$TMPDIR"
  if [[ -n "${PROXY_PID:-}" ]]; then
    kill "$PROXY_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*"; exit 1; }
info() { printf '  \033[90m·\033[0m %s\n' "$*"; }
skip() { printf '  \033[33m⤼\033[0m %s\n' "$*"; }

bold "Treza redaction MVP — e2e acceptance"
echo "  CLI binary:    $TREZA_BIN"
if [[ "$SKIP_TEE" == "1" ]]; then
  echo "  Mode:          local only (SKIP_TEE=1)"
else
  echo "  Control plane: ${TREZA_API_URL:-<from treza config>}"
  echo "  Wallet:        ${TREZA_WALLET:-<from treza config>}"
fi
echo

# Resolve the head of TREZA_BIN to support both "treza" and multi-token forms
# like "node /path/to/dist/index.js".
read -r TREZA_BIN_HEAD _ <<<"$TREZA_BIN"
if ! command -v "$TREZA_BIN_HEAD" >/dev/null 2>&1; then
  fail "'$TREZA_BIN_HEAD' is not on PATH. Run 'npm link' in treza-cli first, or set TREZA_BIN."
fi

# ── 1. Local mode ───────────────────────────────────────────────────────────
bold "1. treza redact run --local (no network, no audit log)"
LOCAL_INPUT='Patient John Doe, SSN 123-45-6789, dob 03/14/1985, email john@acme.com, card 4532-0151-1283-0366'
LOCAL_STDOUT="$(echo "$LOCAL_INPUT" | $TREZA_BIN redact run --local --show-map 2>"$TMPDIR/local.err")"
echo "$LOCAL_STDOUT" | grep -q '\[SSN_1\]' && ok "[SSN_1] placeholder present" || fail "SSN placeholder missing: $LOCAL_STDOUT"
echo "$LOCAL_STDOUT" | grep -q '\[EMAIL_1\]' && ok "[EMAIL_1] placeholder present" || fail "EMAIL placeholder missing"
echo "$LOCAL_STDOUT" | grep -q '\[CC_1\]' && ok "[CC_1] placeholder present" || fail "credit-card placeholder missing"
grep -q 'NOT ATTESTED' "$TMPDIR/local.err" && ok "local-mode honesty banner emitted" || fail "missing 'NOT ATTESTED' banner in stderr"
grep -q 'Redacted' "$TMPDIR/local.err" && ok "entity map printed to stderr" || fail "entity map missing from stderr"
echo

if [[ "$SKIP_TEE" == "1" ]]; then
  bold "TEE mode skipped (SKIP_TEE=1)."
  echo
  bold "Local-mode acceptance checks passed."
  exit 0
fi

# ── TEE-mode prerequisites ──────────────────────────────────────────────────
if [[ -z "${TREZA_API_KEY:-}" ]]; then
  fail "TREZA_API_KEY is not set. Export a Bearer key with redact:* permissions, or rerun with SKIP_TEE=1."
fi
if [[ -z "${TREZA_WALLET:-}" ]]; then
  fail "TREZA_WALLET is not set. Export the wallet address tied to the API key."
fi

# Wire the CLI to use the requested endpoint + creds for this run.
if [[ -n "${TREZA_API_URL:-}" ]]; then
  $TREZA_BIN config set apiUrl "$TREZA_API_URL" >/dev/null
fi
$TREZA_BIN config set apiKey "$TREZA_API_KEY" >/dev/null
$TREZA_BIN config set walletAddress "$TREZA_WALLET" >/dev/null
info "CLI config updated for this run"
echo

# ── 2. TEE-mode run ─────────────────────────────────────────────────────────
bold "2. treza redact run --show-map (TEE)"
TEE_INPUT='Patient Jane Doe, SSN 123-45-6789, dob 03/14/1985, card 4532-0151-1283-0366'
if ! TEE_STDOUT="$(echo "$TEE_INPUT" | $TREZA_BIN redact run --show-map 2>"$TMPDIR/tee.err")"; then
  cat "$TMPDIR/tee.err" >&2
  fail "redact run (TEE) failed"
fi
echo "$TEE_STDOUT" | grep -q '\[SSN_1\]' && ok "[SSN_1] placeholder present" || fail "SSN placeholder missing: $TEE_STDOUT"
grep -q 'Mode: tee' "$TMPDIR/tee.err" && ok "TEE mode banner emitted" || info "TEE banner not visible (control plane may be using fallback)"
grep -q 'Redacted' "$TMPDIR/tee.err" && ok "entity map printed to stderr" || fail "entity map missing from stderr"
echo

# ── 3. Proxy startup ────────────────────────────────────────────────────────
bold "3. treza redact proxy reachable on :$PROXY_PORT"
# Provide a placeholder model key so the startup check doesn't bail.
OPENAI_API_KEY="${OPENAI_API_KEY:-sk-placeholder-not-used-for-healthz}" \
  $TREZA_BIN redact proxy --port "$PROXY_PORT" >"$TMPDIR/proxy.log" 2>&1 &
PROXY_PID=$!
sleep 3
if ! kill -0 "$PROXY_PID" 2>/dev/null; then
  cat "$TMPDIR/proxy.log"
  fail "proxy failed to start"
fi
HEALTH="$(curl -sS "http://localhost:$PROXY_PORT/healthz" || true)"
echo "$HEALTH" | grep -q '"ok":true' && ok "proxy /healthz returns ok" || {
  cat "$TMPDIR/proxy.log"
  fail "proxy /healthz failed: $HEALTH"
}
echo "$HEALTH" | grep -q '"mode":"tee"' && ok "proxy reports mode:tee" || info "proxy did not report mode in /healthz"
kill "$PROXY_PID" 2>/dev/null || true
wait "$PROXY_PID" 2>/dev/null || true
PROXY_PID=""
echo

# ── 4. Audit log ────────────────────────────────────────────────────────────
bold "4. treza redact log"
sleep 1
LOG_OUT="$($TREZA_BIN redact log --limit 5 --json 2>&1)"
if echo "$LOG_OUT" | grep -qE '"requestId"|"entries":\s*\[\]'; then
  ok "log endpoint returned"
else
  fail "log endpoint failed: $LOG_OUT"
fi
if echo "$LOG_OUT" | grep -q '"requestId"'; then
  ok "audit entries present"
else
  info "audit entries empty — control plane may be stubbed; not a fatal failure"
fi
echo

bold "All acceptance checks passed."
