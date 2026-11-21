#!/usr/bin/env bash
# ClauseProof — one-command demo startup (macOS).
#
#   ./start.sh            deps → traces → import → build → serve on 0.0.0.0:3000
#   ./start.sh --tunnel   also open a public tunnel (cloudflared / localtunnel)
#
# Reuses output/traces/<inst>.jsonl when the institution input_hash is
# unchanged; otherwise regenerates via system/run. Degrades gracefully
# offline (skips dep install / tunnel when impossible).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
WEB="$ROOT/web"
OUT="$ROOT/output"
INST_ROOT="$ROOT/institutions"
PORT="${PORT:-3000}"
HOST="${HOST:-0.0.0.0}"
INSTITUTIONS="bank emoney investment payments_fx"
TUNNEL=0
[ "${1:-}" = "--tunnel" ] && TUNNEL=1

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '    \033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[1;33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- 0. checks
say "Checking prerequisites"
command -v python3 >/dev/null 2>&1 || die "python3 not found — install Xcode CLT or python.org 3.9+"
command -v node    >/dev/null 2>&1 || die "node not found — install Node 18+ (https://nodejs.org)"
command -v npm     >/dev/null 2>&1 || die "npm not found — install Node 18+"
ok "python3 $(python3 --version 2>&1 | awk '{print $2}') · node $(node --version) · npm $(npm --version)"

[ -d "$INST_ROOT" ] || die "institutions/ not found (symlink to the dataset missing)"
for inst in $INSTITUTIONS; do
  [ -f "$INST_ROOT/$inst/cases.jsonl" ] || die "institutions/$inst is not a valid institution folder"
done
ok "dataset present: $(echo $INSTITUTIONS | tr ' ' ', ')"

if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  die "port $PORT already in use — stop the other process first:
      $(lsof -nP -iTCP:$PORT -sTCP:LISTEN | tail -n +2 | awk '{print $1" (pid "$2")"}' | head -3)"
fi

# ------------------------------------------------------- 1. web dependencies
say "Web dependencies"
if [ -d "$WEB/node_modules" ] && [ -x "$WEB/node_modules/.bin/next" ]; then
  ok "node_modules present — skipping install"
else
  warn "installing web dependencies (needs network)"
  if (cd "$WEB" && npm ci --no-audit --no-fund); then
    ok "npm ci done"
  elif (cd "$WEB" && npm install --no-audit --no-fund); then
    ok "npm install done"
  else
    die "could not install web deps (offline?). Retry when online."
  fi
fi

# --------------------------------- 2. engine outputs + traces (reuse if same
# input_hash — the engine hashes every input file; if the stored hash matches,
# the stored output is already the exact output a fresh run would produce)
say "Engine outputs + traces"
mkdir -p "$OUT/traces"

input_hash() {  # $1 = institution → sha256 over its input files (engine's hash)
  python3 - "$1" <<'PY'
import sys
sys.path.insert(0, "system")
try:
    from engine import Institution
    print(Institution("institutions/" + sys.argv[1]).input_hash)
except Exception:
    print("")
PY
}

stored_hash() {  # $1 = institution → input_hash recorded in existing trace
  head -n 1 "$OUT/traces/$1.jsonl" 2>/dev/null \
    | python3 -c 'import sys, json
try:
    print(json.loads(sys.stdin.read()).get("input_hash", ""))
except Exception:
    print("")'
}

for inst in $INSTITUTIONS; do
  if [ -f "$OUT/$inst.jsonl" ] && [ -f "$OUT/traces/$inst.jsonl" ] \
     && [ -n "$(stored_hash "$inst")" ] \
     && [ "$(input_hash "$inst")" = "$(stored_hash "$inst")" ]; then
    ok "$inst — input_hash unchanged, reusing output + traces"
  else
    warn "$inst — running system/run (fresh or changed input)"
    (cd "$ROOT/system" && ./run "$INST_ROOT/$inst" "$OUT/$inst.jsonl")
    ok "$inst — engine run complete"
  fi
done

# ---------------------------------------------------- 3. import into the web
say "Importing traces into the web app"
(cd "$WEB" && node scripts/import-traces.mjs)

# ------------------------------------------------------------------- 4. build
say "Building the web app"
(cd "$WEB" && npm run build)

# ------------------------------------------------------- 5. optional tunnel
PUBLIC_URL="${PUBLIC_URL:-}"
TUNNEL_PID=""
TUNNEL_LOG="$(mktemp -t clauseproof-tunnel.XXXXXX)"
SERVER_PID=""

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  [ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" 2>/dev/null || true
  rm -f "$TUNNEL_LOG"
}
trap cleanup EXIT INT TERM

if [ "$TUNNEL" -eq 1 ]; then
  say "Opening public tunnel"
  if command -v cloudflared >/dev/null 2>&1; then
    cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate >"$TUNNEL_LOG" 2>&1 &
    TUNNEL_PID=$!
  elif command -v lt >/dev/null 2>&1; then
    lt --port "$PORT" >"$TUNNEL_LOG" 2>&1 &
    TUNNEL_PID=$!
  else
    # npx forms — they download on first use, so they need a network
    if curl -fsS --max-time 4 -o /dev/null https://registry.npmjs.org/ 2>/dev/null; then
      if npx --yes cloudflared --version >/dev/null 2>&1; then
        npx --yes cloudflared tunnel --url "http://localhost:$PORT" >"$TUNNEL_LOG" 2>&1 &
        TUNNEL_PID=$!
      else
        npx --yes localtunnel --port "$PORT" >"$TUNNEL_LOG" 2>&1 &
        TUNNEL_PID=$!
      fi
    else
      warn "no tunnel binary and registry unreachable — offline, staying on LAN"
    fi
  fi

  if [ -n "$TUNNEL_PID" ]; then
    for _ in $(seq 1 30); do
      PUBLIC_URL="$(grep -Eo 'https://[A-Za-z0-9.-]+\.(trycloudflare\.com|loca\.lt)' "$TUNNEL_LOG" | head -1 || true)"
      [ -n "$PUBLIC_URL" ] && break
      kill -0 "$TUNNEL_PID" 2>/dev/null || break
      sleep 1
    done
    if [ -n "$PUBLIC_URL" ]; then
      ok "public URL: $PUBLIC_URL"
    else
      warn "tunnel did not produce a URL — continuing without it"
      [ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" 2>/dev/null || true
      TUNNEL_PID=""
    fi
  fi
fi

# ------------------------------------------------------------ 6. serve + URLs
lan_ip() {
  local iface ip
  # the interface that owns the default route is the one phones can reach
  iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
  if [ -n "$iface" ]; then
    ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
    [ -n "$ip" ] && { printf '%s' "$ip"; return; }
  fi
  for iface in en0 en1 en2 en3; do
    ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
    [ -n "$ip" ] && { printf '%s' "$ip"; return; }
  done
  ip="$(ifconfig 2>/dev/null | awk '/inet / && $2 != "127.0.0.1" {print $2; exit}')"
  printf '%s' "${ip:-localhost}"
}
LAN="$(lan_ip)"

say "Starting web app on http://$HOST:$PORT"
# the port could have been taken while we built — check once more
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  die "port $PORT was taken while building — free it and retry"
fi
(cd "$WEB" && PUBLIC_URL="$PUBLIC_URL" exec npm start -- --hostname "$HOST" --port "$PORT") &
SERVER_PID=$!

# wait until it answers, and confirm OUR server is the one that survived
ready=0
for _ in $(seq 1 90); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    die "web server exited on startup — is port $PORT taken? see log above"
  fi
  if curl -fsS -o /dev/null "http://localhost:$PORT" 2>/dev/null; then ready=1; break; fi
  sleep 1
done
[ "$ready" = "1" ] || die "web server did not respond on :$PORT within 90s"
sleep 2  # let the bind attempt fully settle
kill -0 "$SERVER_PID" 2>/dev/null \
  || die "web server exited after boot — port $PORT conflict with another process"
curl -fsS -o /dev/null "http://localhost:$PORT" \
  || die "app stopped answering on :$PORT"

cat <<EOF

  ┌─────────────────────────────────────────────────────────────┐
  │                    CLAUSEPROOF IS UP                        │
  └─────────────────────────────────────────────────────────────┘

  Local queue:     http://localhost:$PORT
  Demo on stage:   http://localhost:$PORT/stage      (big screen / projector)
  Phones (LAN):    http://$LAN:$PORT/play            (Beat the Analyst)
  Stage (LAN):     http://$LAN:$PORT/stage           (any LAN display)
EOF
if [ -n "$PUBLIC_URL" ]; then
cat <<EOF
  Public tunnel:   $PUBLIC_URL/play
                   $PUBLIC_URL/stage
EOF
fi
cat <<EOF

  Press Ctrl-C to stop everything.

EOF

wait "$SERVER_PID"
