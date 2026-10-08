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

# Fresh DB → the setup wizard must be reachable: an empty body hits the
# handler's validation (400), not the post-setup guard (403).
check_post() {
  local path="$1" expected="$2" got
  got="$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -X POST "$BASE$path" -d '{}' || true)"
  if [[ "$got" =~ ^($expected)$ ]]; then
    echo "ok   POST $path -> $got"
  else
    echo "FAIL POST $path -> $got (expected $expected)"
    fail=1
  fi
}

check_post /api/wizard/site 400

exit "$fail"
