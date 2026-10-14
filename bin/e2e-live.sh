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
    if [ ! -f "$PROJECT_ROOT/ENVIRONMENT.config" ]; then
        echo "ERROR: ENVIRONMENT.config not found. Run ./bin/setup-participant.sh first."
        exit 1
    fi
    # shellcheck disable=SC1091
    source "$PROJECT_ROOT/ENVIRONMENT.config"
    LOG_GROUP="/aws/lambda/${PROJECT_NAME}-health-${TF_VAR_aws_app_code}"

    echo "INFO: Reading demo passwords from $LOG_GROUP (not printed)..."
    if ! LOGS=$(aws logs tail "$LOG_GROUP" --since 30d --format short 2>/dev/null); then
        echo "ERROR: Could not read CloudWatch. AWS credentials may have expired: run ./bin/setup-participant.sh"
        exit 1
    fi
    LINE=$(echo "$LOGS" | grep "one-time passwords" | tail -1)

    # The log may list the original IDs (ADM001...) or the current ones (AA7K2P...).
    password_for() {
        echo "$LINE" | grep -oE "($1|$2)=[A-Za-z0-9]{6}" | head -1 | cut -d= -f2
    }
    E2E_ADMIN_PASSWORD=$(password_for ADM001 AA7K2P)
    E2E_MANAGER_PASSWORD=$(password_for MGR001 MM4R8T)
    E2E_EMPLOYEE_PASSWORD=$(password_for EMP001 EE3H9W)
    export E2E_ADMIN_PASSWORD E2E_MANAGER_PASSWORD E2E_EMPLOYEE_PASSWORD

    if [ -z "$E2E_ADMIN_PASSWORD" ] || [ -z "$E2E_MANAGER_PASSWORD" ] || [ -z "$E2E_EMPLOYEE_PASSWORD" ]; then
        echo "ERROR: Demo passwords not found in the last 30 days of $LOG_GROUP."
        echo "       Set E2E_ADMIN_PASSWORD, E2E_MANAGER_PASSWORD and E2E_EMPLOYEE_PASSWORD yourself."
        exit 1
    fi
fi

echo "INFO: Running E2E journeys against $E2E_BASE_URL"
cd "$PROJECT_ROOT/frontend"
exec npx playwright test "$@"
