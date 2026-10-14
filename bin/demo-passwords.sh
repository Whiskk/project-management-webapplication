#!/usr/bin/env bash
# Script: Demo Passwords (sourced, not run)
# Purpose: Read the AWS demo accounts' passwords for the live test runners
# Usage: source "$SCRIPT_DIR/demo-passwords.sh" && load_demo_passwords "$PROJECT_ROOT"
#
# On AWS the demo accounts have random passwords, printed once by the health
# Lambda to its private CloudWatch log at first deploy. load_demo_passwords
# reads them from there into DEMO_ADMIN_PASSWORD, DEMO_MANAGER_PASSWORD and
# DEMO_EMPLOYEE_PASSWORD without printing them. Returns non-zero (with a
# message) if they can't be found.

load_demo_passwords() {
    local project_root="$1"
    if [ ! -f "$project_root/ENVIRONMENT.config" ]; then
        echo "ERROR: ENVIRONMENT.config not found. Run ./bin/setup-participant.sh first."
        return 1
    fi
    # shellcheck disable=SC1091
    source "$project_root/ENVIRONMENT.config"
    local log_group="/aws/lambda/${PROJECT_NAME}-health-${TF_VAR_aws_app_code}"

    echo "INFO: Reading demo passwords from $log_group (not printed)..."
    local logs
    if ! logs=$(aws logs tail "$log_group" --since 30d --format short 2>/dev/null); then
        echo "ERROR: Could not read CloudWatch. AWS credentials may have expired: run ./bin/setup-participant.sh"
        return 1
    fi
    local line
    line=$(echo "$logs" | grep "one-time passwords" | tail -1)

    # The log may list the original IDs (ADM001...) or the current ones (AA7K2P...).
    _password_for() {
        echo "$line" | grep -oE "($1|$2)=[A-Za-z0-9]{6}" | head -1 | cut -d= -f2
    }
    DEMO_ADMIN_PASSWORD=$(_password_for ADM001 AA7K2P)
    DEMO_MANAGER_PASSWORD=$(_password_for MGR001 MM4R8T)
    DEMO_EMPLOYEE_PASSWORD=$(_password_for EMP001 EE3H9W)
    unset -f _password_for

    if [ -z "$DEMO_ADMIN_PASSWORD" ] || [ -z "$DEMO_MANAGER_PASSWORD" ] || [ -z "$DEMO_EMPLOYEE_PASSWORD" ]; then
        echo "ERROR: Demo passwords not found in the last 30 days of $log_group."
        return 1
    fi
}
