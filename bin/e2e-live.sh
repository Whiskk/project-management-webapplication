#!/usr/bin/env bash
# Script: E2E Tests Against AWS
# Purpose: Run the Playwright journeys against the live CloudFront site
# Usage: ./e2e-live.sh [playwright options]
#
# On AWS the demo accounts have random passwords, printed once by the health
# Lambda to its private CloudWatch log at first deploy. This script reads them
# from there (without printing them), points Playwright at the live site and
# passes any options through, e.g.
#
#     ./bin/e2e-live.sh                          # all journeys, headless
#     ./bin/e2e-live.sh --ui                     # Playwright UI: watch and replay
#     ./bin/e2e-live.sh --headed --project=desktop
#     ./bin/e2e-live.sh e2e/requests.e2e.js --headed
#
# Run one suite at a time: journeys share the live database and demo accounts.

set -e

DEFAULT_URL="https://d37hjhs1g613o6.cloudfront.net"

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    echo "Usage: $0 [playwright options]"
    echo ""
    echo "Runs frontend/e2e against the live site. Options are passed to 'playwright test'."
    echo "  --ui                      open the Playwright UI (watch, pick and replay tests)"
    echo "  --headed                  show the browser window"
    echo "  --project=desktop|mobile  one browser profile only"
    echo "  e2e/<file>.e2e.js         one journey file"
    echo ""
    echo "Environment (optional):"
    echo "  E2E_BASE_URL              site to test (default: $DEFAULT_URL)"
    echo "  E2E_ADMIN_PASSWORD, E2E_MANAGER_PASSWORD, E2E_EMPLOYEE_PASSWORD"
    echo "                            skip the CloudWatch lookup when all three are set"
    exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" > /dev/null 2>&1 || exit 1; pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." > /dev/null 2>&1 || exit 1; pwd -P)"

export E2E_BASE_URL="${E2E_BASE_URL:-$DEFAULT_URL}"

if [ -z "${E2E_ADMIN_PASSWORD:-}" ] || [ -z "${E2E_MANAGER_PASSWORD:-}" ] || [ -z "${E2E_EMPLOYEE_PASSWORD:-}" ]; then
    # shellcheck source=demo-passwords.sh
    source "$SCRIPT_DIR/demo-passwords.sh"
    if ! load_demo_passwords "$PROJECT_ROOT"; then
        echo "       Set E2E_ADMIN_PASSWORD, E2E_MANAGER_PASSWORD and E2E_EMPLOYEE_PASSWORD yourself."
        exit 1
    fi
    export E2E_ADMIN_PASSWORD="$DEMO_ADMIN_PASSWORD"
    export E2E_MANAGER_PASSWORD="$DEMO_MANAGER_PASSWORD"
    export E2E_EMPLOYEE_PASSWORD="$DEMO_EMPLOYEE_PASSWORD"
fi

echo "INFO: Running E2E journeys against $E2E_BASE_URL"
cd "$PROJECT_ROOT/frontend"
exec npx playwright test "$@"
