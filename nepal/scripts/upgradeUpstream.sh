#!/usr/bin/env bash
# Upgrade capture-app-np to a newer upstream dhis2/capture-app release tag.
# Delegates to the history-independent 3-way sync engine (nepal/scripts/syncUpstream.mjs),
# so it works cleanly even in fresh repositories without shared upstream git history.
#
# Usage:
#   npm run nepal:upgrade                    # Sync to latest DHIS2 2.41+ stable tag
#   npm run nepal:upgrade -- v107.10.0       # Sync to a specific upstream tag
#   npm run nepal:upgrade -- --dry-run       # Preview changes without modifying files
#   npm run nepal:upgrade -- --check         # Check for newer compatible releases

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

exec node nepal/scripts/syncUpstream.mjs "$@"
