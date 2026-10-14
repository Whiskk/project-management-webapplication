#!/usr/bin/env bash
# Script: Live Smoke Test
# Purpose: End-to-end API checks against a running environment (local or AWS)
# Usage: ./smoke-test.sh [api_base_url]
#
# Exercises auth, RBAC, users, projects, staffing (40-hour and budget rules)
# and cross-team approval through the real API, proxy/CloudFront, Lambdas and
# database. Creates clearly named "Smoke test ... (safe to ignore)" projects and
# archives them at the end; every edit to existing data is reverted.

set -u

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    echo "Usage: $0 [api_base_url]"
    echo ""
    echo "Arguments:"
    echo "  api_base_url    Default: http://localhost:3001 (local dev proxy)."
    echo "                  For AWS use the CloudFront URL, e.g. https://dxxxx.cloudfront.net"
    echo ""
    echo "Environment (demo account passwords; defaults are the local-only demo values):"
    echo "  SMOKE_ADMIN_PASSWORD     password for AA7K2P"
    echo "  SMOKE_MANAGER_PASSWORD   password for MM4R8T"
    echo "  SMOKE_EMPLOYEE_PASSWORD  password for EE3H9W"
    exit 0
fi

BASE="${1:-http://localhost:3001}"
API="${BASE%/}/api"
J='Content-Type: application/json'
pass=0
fail=0

check() {
    if [ "$2" = "$3" ]; then
        echo "  PASS $1"; pass=$((pass + 1))
    else
        echo "  FAIL $1 (expected $2, got $3)"; fail=$((fail + 1))
    fi
}
status() { curl -s -o /dev/null -w '%{http_code}' -m 30 "$@"; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)" 2>/dev/null; }
login() {
    curl -s -m 30 -X POST "$API/auth/login" -H "$J" \
        -d "{\"employee_id\":\"$1\",\"password\":\"$2\"}" | json 'd.get("access_token","")'
}

echo "Smoke testing $API"

echo "[health]"
check "API and database up" ok "$(curl -s -m 30 "$API/health" | json 'd["database"]')"

echo "[auth]"
ADMIN_TOKEN=$(login AA7K2P "${SMOKE_ADMIN_PASSWORD:-Admin1}")
MANAGER_TOKEN=$(login MM4R8T "${SMOKE_MANAGER_PASSWORD:-Mngr01}")
EMPLOYEE_TOKEN=$(login EE3H9W "${SMOKE_EMPLOYEE_PASSWORD:-Empl01}")
check "admin login" yes "$([ -n "$ADMIN_TOKEN" ] && echo yes || echo no)"
check "manager login" yes "$([ -n "$MANAGER_TOKEN" ] && echo yes || echo no)"
check "employee login" yes "$([ -n "$EMPLOYEE_TOKEN" ] && echo yes || echo no)"
if [ -z "$ADMIN_TOKEN" ] || [ -z "$MANAGER_TOKEN" ] || [ -z "$EMPLOYEE_TOKEN" ]; then
    echo "Cannot continue without all three logins (check the SMOKE_*_PASSWORD variables)."
    exit 1
fi
A="Authorization: Bearer $ADMIN_TOKEN"
M="Authorization: Bearer $MANAGER_TOKEN"
E="Authorization: Bearer $EMPLOYEE_TOKEN"
check "no token is rejected" 401 "$(status "$API/users")"
check "bad password is rejected" 401 "$(status -X POST -H "$J" -d '{"employee_id":"EE3H9W","password":"wrong!"}' "$API/auth/login")"

echo "[users]"
MGR_ID=$(curl -s -m 30 -H "$A" "$API/users?q=MM4R8T" | json 'd["items"][0]["id"]')
EMP_ID=$(curl -s -m 30 -H "$A" "$API/users?q=EE3H9W" | json 'd["items"][0]["id"]')
ADM_ID=$(curl -s -m 30 -H "$A" "$API/users?q=AA7K2P" | json 'd["items"][0]["id"]')
check "employee cannot list users" 403 "$(status -H "$E" "$API/users")"
check "manager cannot see admin salary" None "$(curl -s -m 30 -H "$M" "$API/users?q=AA7K2P" | json 'd["items"][0]["salary"]')"
check "manager cannot edit a non-report" 403 "$(status -X PATCH -H "$M" -H "$J" -d '{"first_name":"X"}' "$API/users/$ADM_ID")"
check "employee cannot change own role" 400 "$(status -X PATCH -H "$E" -H "$J" -d '{"role":"admin"}' "$API/users/me")"
ORIGINAL=$(curl -s -m 30 -H "$E" "$API/users/$EMP_ID" | json 'd["first_name"]')
check "employee edits own name" 200 "$(status -X PATCH -H "$E" -H "$J" -d '{"first_name":"Smoke"}' "$API/users/me")"
check "employee name restored" 200 "$(status -X PATCH -H "$E" -H "$J" -d "{\"first_name\":\"$ORIGINAL\"}" "$API/users/me")"

echo "[projects]"
create_project() {
    curl -s -m 30 -X POST -H "$A" -H "$J" \
        -d "{\"name\":\"$1\",\"start_date\":\"2031-03-03\",\"predicted_end_date\":\"2031-03-14\",\"budget\":$2,\"manager_id\":$MGR_ID}" \
        "$API/projects" | json 'd["id"]'
}
check "manager cannot create projects" 403 "$(status -X POST -H "$M" -H "$J" -d '{}' "$API/projects")"
P1=$(create_project "Smoke test project (safe to ignore)" 1000000)
P2=$(create_project "Smoke test second project (safe to ignore)" 1000000)
check "admin creates projects" yes "$([ -n "$P1" ] && [ -n "$P2" ] && echo yes || echo no)"
check "manager sees own project" 200 "$(status -H "$M" "$API/projects/$P1")"
check "unassigned employee gets 404" 404 "$(status -H "$E" "$API/projects/$P1")"
check "manager cannot rename" 400 "$(status -X PATCH -H "$M" -H "$J" -d '{"name":"x"}' "$API/projects/$P1")"
check "PUT also updates" 200 "$(status -X PUT -H "$M" -H "$J" -d '{"description":"smoke"}' "$API/projects/$P1")"

echo "[staffing: 40-hour and budget rules]"
AVAILABLE=$(curl -s -m 30 -H "$M" "$API/projects/$P1/staffing-options" | json "[o for o in d['items'] if o['user_id']==$EMP_ID][0]['available_hours']")
FILL=$(python3 -c "print(max(${AVAILABLE:-0} - 10, 0.5))")
check "staff employee on project 1" 201 "$(status -X POST -H "$M" -H "$J" -d "{\"user_id\":$EMP_ID,\"hours_per_week\":$FILL}" "$API/projects/$P1/assignments")"
check "more than 40 h/week is refused" 409 "$(status -X POST -H "$M" -H "$J" -d "{\"user_id\":$EMP_ID,\"hours_per_week\":10.5}" "$API/projects/$P2/assignments")"
check "staff 10 h on project 2" 201 "$(status -X POST -H "$M" -H "$J" -d "{\"user_id\":$EMP_ID,\"hours_per_week\":10}" "$API/projects/$P2/assignments")"
COST=$(curl -s -m 30 -H "$M" "$API/projects/$P2" | json 'd["projected_cost"]')
check "budget below cost is refused" 409 "$(status -X PATCH -H "$M" -H "$J" -d "{\"budget\":$(python3 -c "print(${COST:-0} - 1)")}" "$API/projects/$P2")"
check "budget exactly at cost is allowed" 200 "$(status -X PATCH -H "$M" -H "$J" -d "{\"budget\":$COST}" "$API/projects/$P2")"
A2=$(curl -s -m 30 -H "$M" "$API/projects/$P2/assignments" | json 'd["items"][0]["id"]')
check "going over budget is refused" 409 "$(status -X PATCH -H "$M" -H "$J" -d '{"hours_per_week":10.5}' "$API/projects/$P2/assignments/$A2")"
check "reducing hours is always allowed" 200 "$(status -X PATCH -H "$M" -H "$J" -d '{"hours_per_week":8}' "$API/projects/$P2/assignments/$A2")"
check "employee sees own hours, not cost" "8.0 False" "$(curl -s -m 30 -H "$E" "$API/projects/$P2" | json 'str(d["my_hours_per_week"]) + " " + str("projected_cost" in d)')"
check "assigned employee cannot be deactivated" 409 "$(status -X POST -H "$A" "$API/users/$EMP_ID/deactivate")"

echo "[cross-team approval]"
A1=$(curl -s -m 30 -H "$M" "$API/projects/$P1/assignments" | json 'd["items"][0]["id"]')
check "admin removes from project 1" 204 "$(status -X DELETE -H "$A" "$API/projects/$P1/assignments/$A1")"
R=$(curl -s -m 30 -X POST -H "$A" -H "$J" -d "{\"user_id\":$EMP_ID,\"hours_per_week\":5}" "$API/projects/$P1/assignments")
A1=$(echo "$R" | json 'd["id"]')
check "admin request needs Eli's manager" "pending Morgan Manager" "$(echo "$R" | json 'd["status"] + " " + d["approver_name"]')"
check "manager inbox lists it" True "$(curl -s -m 30 -H "$M" "$API/projects/approvals" | json "any(i['assignment_id']==$A1 for i in d['items'])")"
check "admin cannot approve" 403 "$(status -X POST -H "$A" "$API/projects/$P1/assignments/$A1/approve")"
check "employee's manager approves" approved "$(curl -s -m 30 -X POST -H "$M" "$API/projects/$P1/assignments/$A1/approve" | json 'd["status"]')"
check "increase becomes pending" "5.0 7.0" "$(curl -s -m 30 -X PATCH -H "$A" -H "$J" -d '{"hours_per_week":7}' "$API/projects/$P1/assignments/$A1" | json 'str(d["hours_per_week"]) + " " + str(d["pending_hours"])')"
check "manager rejects increase" "5.0 None" "$(curl -s -m 30 -X POST -H "$M" -H "$J" -d '{"note":"smoke test"}' "$API/projects/$P1/assignments/$A1/reject" | json 'str(d["assignment"]["hours_per_week"]) + " " + str(d["assignment"]["pending_hours"])')"

echo "[milestones]"
ms() { curl -s -m 30 -X POST -H "$M" -H "$J" -d "$1" "$API/projects/$P1/milestones" | json 'd["id"]'; }
M1=$(ms '{"title":"Smoke design","start_date":"2031-03-03","due_date":"2031-03-05"}')
M2=$(ms "{\"title\":\"Smoke build\",\"start_date\":\"2031-03-06\",\"due_date\":\"2031-03-12\",\"depends_on\":[$M1]}")
check "manager adds dependent milestones" yes "$([ -n "$M1" ] && [ -n "$M2" ] && echo yes || echo no)"
check "employee cannot add milestones" 403 "$(status -X POST -H "$E" -H "$J" -d '{}' "$API/projects/$P1/milestones")"
check "cannot start before dependency is due" 400 "$(status -X PATCH -H "$M" -H "$J" -d '{"start_date":"2031-03-04"}' "$API/projects/$P1/milestones/$M2")"
check "cannot start work before dependency is done" 409 "$(status -X PATCH -H "$M" -H "$J" -d '{"status":"in_progress"}' "$API/projects/$P1/milestones/$M2")"
check "circular dependency is refused" 409 "$(status -X PATCH -H "$M" -H "$J" -d "{\"depends_on\":[$M2]}" "$API/projects/$P1/milestones/$M1")"
check "complete dependency" 200 "$(status -X PATCH -H "$M" -H "$J" -d '{"status":"completed"}' "$API/projects/$P1/milestones/$M1")"
check "then work can start" 200 "$(status -X PATCH -H "$M" -H "$J" -d '{"status":"in_progress"}' "$API/projects/$P1/milestones/$M2")"
check "progress is tracked" 50 "$(curl -s -m 30 -H "$M" "$API/projects/$P1/milestones" | json 'd["summary"]["percent_complete"]')"
check "cannot delete a milestone others depend on" 409 "$(status -X DELETE -H "$M" "$API/projects/$P1/milestones/$M1")"

echo "[project requests]"
req() { curl -s -m 30 -X POST -H "$M" -H "$J" -d "{\"name\":\"$1\",\"start_date\":\"2031-04-07\",\"predicted_end_date\":\"2031-04-18\",\"budget\":5000,\"justification\":\"smoke test\"}" "$API/projects/requests" | json 'd["id"]'; }
R1=$(req "Smoke test request (safe to ignore)")
R2=$(req "Smoke test withdrawn request (safe to ignore)")
check "manager submits requests" yes "$([ -n "$R1" ] && [ -n "$R2" ] && echo yes || echo no)"
check "admin cannot submit" 403 "$(status -X POST -H "$A" -H "$J" -d '{}' "$API/projects/requests")"
check "manager cannot approve" 403 "$(status -X POST -H "$M" -H "$J" -d '{}' "$API/projects/requests/$R1/approve")"
check "rejection needs a reason" 400 "$(status -X POST -H "$A" -H "$J" -d '{}' "$API/projects/requests/$R1/reject")"
check "manager withdraws own request" withdrawn "$(curl -s -m 30 -X POST -H "$M" "$API/projects/requests/$R2/withdraw" | json 'd["status"]')"
P3=$(curl -s -m 30 -X POST -H "$A" -H "$J" -d '{"budget":4000}' "$API/projects/requests/$R1/approve" | json 'd["project_id"]')
check "approval creates the project" 4000.0 "$(curl -s -m 30 -H "$M" "$API/projects/$P3" | json 'd["budget"]')"
check "decided request cannot be decided again" 409 "$(status -X POST -H "$A" -H "$J" -d '{"note":"x"}' "$API/projects/requests/$R1/reject")"
check "archive requested project (cleanup)" 200 "$(status -X POST -H "$A" "$API/projects/$P3/archive")"

echo "[audit log]"
check "manager cannot read the audit log" 403 "$(status -H "$M" "$API/audit")"
check "admin sees this run's project in the log" True "$(curl -s -m 30 -H "$A" "$API/audit?project_id=$P1&page_size=200" | json 'any(i["action"] == "project.create" for i in d["items"])')"
check "denied attempts are recorded" True "$(curl -s -m 30 -H "$A" "$API/audit?outcome=denied&actor=MM4R8T&page_size=5" | json 'd["total"] > 0')"
check "audit log has no write routes" 405 "$(status -X DELETE -H "$A" "$API/audit")"

echo "[budget monitor]"
check "manager cannot trigger the budget check" 403 "$(status -X POST -H "$M" "$API/monitor/run")"
check "admin runs the budget check" True "$(curl -s -m 60 -X POST -H "$A" "$API/monitor/run" | json 'd["checked"] >= 1')"

echo "[cleanup]"
for pair in "$P1:$A1" "$P2:$A2"; do
    check "remove assignment ${pair#*:}" 204 "$(status -X DELETE -H "$A" "$API/projects/${pair%%:*}/assignments/${pair#*:}")"
done
check "archive project 1" 200 "$(status -X POST -H "$A" "$API/projects/$P1/archive")"
check "archive project 2" 200 "$(status -X POST -H "$A" "$API/projects/$P2/archive")"
check "archived projects are read-only" 409 "$(status -X PATCH -H "$A" -H "$J" -d '{"budget":1}' "$API/projects/$P1")"

echo ""
echo "Result: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
