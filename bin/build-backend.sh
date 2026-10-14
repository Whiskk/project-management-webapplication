#!/usr/bin/env bash
# Script: Build Backend Lambda Packages
# Purpose: Assemble one self-contained package per backend service
# Usage: ./build-backend.sh
#
# Source stays clean: backend/services/<name>/ holds only that service's code,
# backend/shared/pm_core/ the shared library, backend/requirements.txt the one
# list of runtime libraries. This script assembles, for every service,
#
#     backend/.build/<name>/ = service code + pm_core + libraries
#
# which Terraform zips into the Lambda and LocalStack mounts for hot reload.
# Libraries are installed once (for the Lambda runtime: Python 3.13, manylinux
# x86_64) into backend/.build/_deps and hard-linked into each package, so they
# take no extra disk space. Run it after changing backend code; start-dev.sh and
# deploy-backend.sh run it automatically.

set -e

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    echo "Usage: $0"
    echo "Assemble backend/.build/<service>/ for every service in backend/services/"
    exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" > /dev/null 2>&1 || exit 1; pwd -P)"
BACKEND="$(cd "$SCRIPT_DIR/../backend" > /dev/null 2>&1 || exit 1; pwd -P)"
BUILD="$BACKEND/.build"
DEPS="$BUILD/_deps"
REQUIREMENTS="$BACKEND/requirements.txt"

mkdir -p "$BUILD"

# 1. Libraries: installed once, re-installed only when requirements.txt changes.
REQS_HASH=$(md5sum "$REQUIREMENTS" | cut -d' ' -f1)
if [ "$(cat "$DEPS/.requirements-hash" 2>/dev/null)" != "$REQS_HASH" ]; then
    echo "  Installing backend libraries for the Lambda runtime..."
    rm -rf "$DEPS"
    python3 -m pip install --quiet --target "$DEPS" \
        --platform manylinux2014_x86_64 --python-version 3.13 \
        --implementation cp --only-binary=:all: -r "$REQUIREMENTS"
    echo "$REQS_HASH" > "$DEPS/.requirements-hash"
else
    echo "  Backend libraries up to date"
fi

# 2. One package per service. Directories are refreshed in place (not deleted)
#    because LocalStack hot reload mounts them.
shopt -s nullglob
for fn in "$BACKEND"/services/*/function.py; do
    src="$(dirname "$fn")"
    name="$(basename "$src")"
    out="$BUILD/$name"
    mkdir -p "$out"
    find "$out" -mindepth 1 -delete
    cp -al "$DEPS"/. "$out"/                       # libraries (hard links)
    rm -f "$out/.requirements-hash"
    cp -R "$BACKEND/shared/pm_core" "$out/pm_core"  # shared library
    rsync -a --exclude "__pycache__" "$src"/ "$out"/  # the service's own code
    echo "  ✓ built backend/.build/$name"
done
shopt -u nullglob
