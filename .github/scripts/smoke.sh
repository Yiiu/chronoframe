#!/usr/bin/env bash
# Smoke-test a running ChronoFrame server: it must come up, serve the photos
# API and render the home page (200, or 302 to /onboarding on a fresh DB).
# usage: smoke.sh <base-url> [timeout-seconds]
set -euo pipefail

BASE="${1:?usage: smoke.sh <base-url> [timeout-seconds]}"
TIMEOUT="${2:-90}"

status() { curl -s -o /dev/null -w '%{http_code}' "$BASE$1" || true; }

echo "Waiting for $BASE (up to ${TIMEOUT}s)..."
for ((i = 0; i < TIMEOUT; i += 2)); do
  [ "$(status /api/photos)" = "200" ] && break
  sleep 2
done

fail=0
check() {
  local path="$1" expected="$2" got
  got="$(status "$path")"
  if [[ "$got" =~ ^($expected)$ ]]; then
    echo "ok   GET $path -> $got"
  else
    echo "FAIL GET $path -> $got (expected $expected)"
    fail=1
  fi
}

check /api/photos 200
check / '200|302'
check /onboarding 200

exit "$fail"
