#!/usr/bin/env bash
# Script: Sync Shared Backend Code
# Purpose: Copy backend/_shared/pm_core into every deployable Python service
# Usage: ./sync-shared.sh
#
# Each backend/<service>/ folder is packaged as its own Lambda (and mounted
# directly by LocalStack hot-reload), so shared code must physically live in
# each folder. The copies are gitignored; edit backend/_shared/pm_core only.

set -e

if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    echo "Usage: $0"
    echo "Copy backend/_shared/pm_core into every Python service under backend/"
    exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" > /dev/null 2>&1 || exit 1; pwd -P)"
PROJECT_ROOT="$(cd $SCRIPT_DIR/.. > /dev/null 2>&1 || exit 1; pwd -P)"
SHARED_DIR="$PROJECT_ROOT/backend/_shared/pm_core"

if [ ! -d "$SHARED_DIR" ]; then
    echo "ERROR: $SHARED_DIR not found"
    exit 1
fi

shopt -s nullglob
for fn in "$PROJECT_ROOT"/backend/*/function.py; do
    svc_dir="$(dirname "$fn")"
    case "$(basename "$svc_dir")" in _*|.*) continue ;; esac
    rm -rf "$svc_dir/pm_core"
    cp -R "$SHARED_DIR" "$svc_dir/pm_core"
    find "$svc_dir/pm_core" -name "__pycache__" -type d -prune -exec rm -rf {} +
    echo "  ✓ synced pm_core -> backend/$(basename "$svc_dir")"
done
shopt -u nullglob
