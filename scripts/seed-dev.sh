#!/usr/bin/env bash
# Seed the local dev server's KV with real list/hours data, so the
# client and map can be verified in local dev (workerd can't reach the
# internet from this sandbox, so live Google fetches fail in dev).
#
# Usage: ./scripts/seed-dev.sh
#   1. Runs the Node harness (real fetches via the sandbox proxy) to
#      dump a KV manifest into ./fixtures-manifest.json.
#   2. POSTs each envelope to /api/debug-seed (dev-only route) on the
#      dev server at http://127.0.0.1:5173.
#
# The dev server must be running (`npm run dev`) before step 2.
# The harness fetches the two example lists baked into harness.ts;
# edit SHORT1/SHORT2 there to seed different lists.
set -euo pipefail
cd "$(dirname "$0")/.."

./node_modules/.bin/esbuild scripts/harness/harness.ts --bundle \
  --platform=node --format=esm --outfile=/tmp/openlist-harness.mjs \
  --alias:void/kv="$PWD/scripts/harness/kv-stub.ts" --log-level=warning
node /tmp/openlist-harness.mjs

python3 - <<'EOF'
import json, subprocess

manifest = json.load(open("fixtures-manifest.json"))
for key, value in manifest.items():
    with open("/tmp/openlist-seed-body.json", "w") as f:
        json.dump({"key": key, "value": value}, f)
    r = subprocess.run(["curl", "-s", "-X", "POST",
                        "http://127.0.0.1:5173/api/debug-seed",
                        "-H", "Content-Type: application/json",
                        "--data-binary", "@/tmp/openlist-seed-body.json"],
                       capture_output=True, text=True, timeout=60)
    print(key, "->", r.stdout.strip()[:80])
EOF

echo "Seeded. Open http://localhost:5173/?list=<short-link> to view."
