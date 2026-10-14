#!/usr/bin/env bash
# Script: API Tests (Postman collection via Newman)
# Purpose: Run postman/project-hub.postman_collection.json against local or AWS
# Usage: ./api-tests.sh [local|aws] [newman options]
#
#     ./bin/api-tests.sh                  # local stack (./bin/start-dev.sh), documented demo passwords
#     ./bin/api-tests.sh aws              # live site; passwords read from CloudWatch, never printed
#     ./bin/api-tests.sh aws --folder "5. Milestones and tasks"
#
# Writes an HTML report to postman/reports/api-tests-<target>.html. The suite
# creates clearly named "Postman API test ... (safe to ignore)" data and archives
# or deactivates it at the end. Don't run it alongside the Playwright or smoke
# suites: they share the demo accounts.

set -e

NEWMAN="newman@6.2.1"
REPORTER="newman-reporter-htmlextra@1.23.1"

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    echo "Usage: $0 [local|aws] [newman options]"
    echo ""
    echo "  local (default)   http://localhost:3001 with the local demo passwords"
    echo "  aws               the CloudFront site; demo passwords read from CloudWatch"
    echo ""
    echo "Environment (optional):"
    echo "  API_BASE_URL      override the target URL"
    echo "  API_ADMIN_PASSWORD, API_MANAGER_PASSWORD, API_EMPLOYEE_PASSWORD"
    echo "                    skip the CloudWatch lookup when all three are set"
    exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" > /dev/null 2>&1 || exit 1; pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." > /dev/null 2>&1 || exit 1; pwd -P)"

TARGET="local"
if [ "${1:-}" = "local" ] || [ "${1:-}" = "aws" ]; then
    TARGET="$1"
    shift
fi

npx --version > /dev/null 2>&1 || { echo "ERROR: 'npx' is missing (install Node.js). Aborting..."; exit 1; }

ENV_FILE="$PROJECT_ROOT/postman/$TARGET.postman_environment.json"
REPORT="$PROJECT_ROOT/postman/reports/api-tests-$TARGET.html"
EXTRA=()

if [ "$TARGET" = "aws" ]; then
    if [ -z "${API_ADMIN_PASSWORD:-}" ] || [ -z "${API_MANAGER_PASSWORD:-}" ] || [ -z "${API_EMPLOYEE_PASSWORD:-}" ]; then
        # shellcheck source=demo-passwords.sh
        source "$SCRIPT_DIR/demo-passwords.sh"
        if ! load_demo_passwords "$PROJECT_ROOT"; then
            echo "       Set API_ADMIN_PASSWORD, API_MANAGER_PASSWORD and API_EMPLOYEE_PASSWORD yourself."
            exit 1
        fi
        API_ADMIN_PASSWORD="$DEMO_ADMIN_PASSWORD"
        API_MANAGER_PASSWORD="$DEMO_MANAGER_PASSWORD"
        API_EMPLOYEE_PASSWORD="$DEMO_EMPLOYEE_PASSWORD"
    fi
    EXTRA+=(--env-var "adminPassword=$API_ADMIN_PASSWORD"
            --env-var "managerPassword=$API_MANAGER_PASSWORD"
            --env-var "employeePassword=$API_EMPLOYEE_PASSWORD")
fi
if [ -n "${API_BASE_URL:-}" ]; then
    EXTRA+=(--env-var "baseUrl=${API_BASE_URL%/}")
fi

echo "INFO: Running the API test collection against $TARGET${API_BASE_URL:+ ($API_BASE_URL)}"
mkdir -p "$(dirname "$REPORT")"
# Secrets are kept out of the HTML report (--reporter-htmlextra-skipSensitiveData).
exec npx --yes -p "$NEWMAN" -p "$REPORTER" newman run "$PROJECT_ROOT/postman/project-hub.postman_collection.json" \
    --environment "$ENV_FILE" \
    "${EXTRA[@]}" \
    --timeout-request 60000 \
    --reporters cli,htmlextra \
    --reporter-htmlextra-export "$REPORT" \
    --reporter-htmlextra-title "Project Hub API tests ($TARGET)" \
    --reporter-htmlextra-skipSensitiveData \
    "$@"
