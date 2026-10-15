"""
Audit service: read-only access to the audit log.

Admins see every entry. Managers see only their own entries, entries made by
their current direct reports (employees), and failed sign-ins against their own
or their reports' accounts - never other managers' or admins' activity.
Employees cannot read the log.

Routes (under /api/audit):
    GET /           filtered, paginated entries, newest first
                    ?q= &actor= (employee id) &role= &action= &entity_type= &outcome=
                    &project_id= &from= (YYYY-MM-DD) &to= (YYYY-MM-DD) &page= &page_size=
    GET /export     the same filters, as a CSV download (newest first, at most 5,000 rows)
    GET /actions    distinct action names, for filter menus

There are deliberately no write routes: entries are only created by the other
services, inside the same transaction as the change they describe, and the
database rejects any UPDATE, DELETE or TRUNCATE on the table.
"""

import csv
import io
import json
from datetime import UTC, date, datetime, timedelta
from typing import Any

from psycopg import sql

from pm_core.auth import ROLES, require_auth
from pm_core.db import transaction
from pm_core.errors import ValidationError
from pm_core.http import Request, Response, Router, ok, text
from pm_core.validation import parse_choice, parse_id, parse_pagination

router = Router("audit")

OUTCOMES = ("success", "denied")
# Keeps an export well inside the 6 MB Lambda response limit; narrow the filters for more.
EXPORT_LIMIT = 5000
EXPORT_COLUMNS = (
    ("occurred_at", "Time (UTC)"),
    ("actor_employee_id", "Employee ID"),
    ("actor_name", "Name"),
    ("actor_role", "Role"),
    ("action", "Action"),
    ("outcome", "Outcome"),
    ("entity_type", "Record type"),
    ("entity_id", "Record ID"),
    ("project_name", "Project"),
    ("summary", "Summary"),
    ("changes", "Changes"),
)

# What a manager may see: their own entries, their direct reports' (employees
# only, so a report later promoted to manager drops out), and failed sign-ins
# aimed at their own or their reports' accounts (those have no actor).
MANAGER_SCOPE = """(
    l.actor_id = %s
    OR (l.actor_role = 'employee' AND l.actor_id IN (
        SELECT id FROM users WHERE manager_id = %s AND role = 'employee'))
    OR (l.action = 'auth.login' AND l.actor_id IS NULL AND l.entity_type = 'user' AND (
        l.entity_id = %s
        OR l.entity_id IN (SELECT id FROM users WHERE manager_id = %s AND role = 'employee')))
)"""


def _scope(request: Request) -> tuple[list[sql.Composable], list[Any]]:
    """Visibility conditions and parameters for the signed-in user (none for admins)."""
    if request.actor.role == "admin":
        return [], []
    return [sql.SQL(MANAGER_SCOPE)], [request.actor.id] * MANAGER_SCOPE.count("%s")


def _parse_date(query: dict[str, str], name: str) -> date | None:
    raw = query.get(name)
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise ValidationError({name: "Must be a date (YYYY-MM-DD)"}) from None


def serialize(row: dict) -> dict:
    """An audit entry as shown in the Audit Log."""
    keys = (
        "id",
        "occurred_at",
        "actor_id",
        "actor_employee_id",
        "actor_name",
        "actor_role",
        "action",
        "entity_type",
        "entity_id",
        "project_id",
        "project_name",
        "summary",
        "changes",
        "outcome",
    )
    return {key: row[key] for key in keys}


def _filters(request: Request) -> tuple[sql.Composable, list[Any]]:
    """The WHERE clause and parameters for the query string, within what the user may see."""
    query = request.query
    role = parse_choice(query, "role", ROLES)
    outcome = parse_choice(query, "outcome", OUTCOMES)
    start, end = _parse_date(query, "from"), _parse_date(query, "to")
    if start and end and end < start:
        raise ValidationError({"to": "Must be on or after the 'from' date"})

    conditions, params = _scope(request)

    def add(condition: str, *values: Any) -> None:
        conditions.append(sql.SQL(condition))
        params.extend(values)

    if query.get("actor"):
        add("upper(l.actor_employee_id) = upper(%s)", query["actor"].strip())
    if role:
        add("l.actor_role = %s", role)
    if query.get("action"):
        add("l.action = %s", query["action"])
    if query.get("entity_type"):
        add("l.entity_type = %s", query["entity_type"])
    if outcome:
        add("l.outcome = %s", outcome)
    if query.get("project_id"):
        add("l.project_id = %s", parse_id(query["project_id"], "project_id"))
    if start:
        add("l.occurred_at >= %s", start)
    if end:
        add("l.occurred_at < %s", end + timedelta(days=1))  # inclusive of the whole 'to' day
    if query.get("q", "").strip():
        term = f"%{query['q'].strip()}%"
        add("(l.summary ILIKE %s OR l.actor_name ILIKE %s OR l.actor_employee_id ILIKE %s)", term, term, term)

    where = sql.SQL(" WHERE ") + sql.SQL(" AND ").join(conditions) if conditions else sql.SQL("")
    return where, params


_SELECT_ENTRIES = sql.SQL(
    "SELECT l.*, p.name AS project_name FROM audit_log l LEFT JOIN projects p ON p.id = l.project_id"
)
_NEWEST_FIRST = sql.SQL(" ORDER BY l.occurred_at DESC, l.id DESC LIMIT %s OFFSET %s")


@router.get("/")
@require_auth("admin", "manager")
def list_entries(request: Request) -> Response:
    """Search the audit log, limited to what the signed-in user may see."""
    limit, offset = parse_pagination(request.query, default_size=50, max_size=200)
    where, params = _filters(request)
    with transaction() as cur:
        cur.execute(sql.SQL("SELECT COUNT(*) AS n FROM audit_log l") + where, params)
        total = cur.fetchone()["n"]
        cur.execute(_SELECT_ENTRIES + where + _NEWEST_FIRST, [*params, limit, offset])
        rows = cur.fetchall()
    return ok({"items": [serialize(r) for r in rows], "total": total})


def _csv_cell(value: Any) -> str:
    """
    One CSV cell. Text starting with = + - @ (or a tab/CR) is prefixed with an
    apostrophe so a spreadsheet shows it rather than running it as a formula -
    project names and summaries contain text users typed.
    """
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, dict):
        value = json.dumps(value) if value else ""
    value = str(value)
    return "'" + value if value[:1] in ("=", "+", "-", "@", "\t", "\r") else value


@router.get("/export")
@require_auth("admin", "manager")
def export_entries(request: Request) -> Response:
    """The filtered audit log as a CSV file, newest first."""
    where, params = _filters(request)
    with transaction() as cur:
        cur.execute(_SELECT_ENTRIES + where + _NEWEST_FIRST, [*params, EXPORT_LIMIT, 0])
        rows = cur.fetchall()
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow([label for _, label in EXPORT_COLUMNS])
    for row in rows:
        writer.writerow([_csv_cell(row[key]) for key, _ in EXPORT_COLUMNS])
    filename = f"audit-log-{datetime.now(UTC):%Y-%m-%d}.csv"
    return text(out.getvalue(), "text/csv; charset=utf-8", filename)


@router.get("/actions")
@require_auth("admin", "manager")
def list_actions(request: Request) -> Response:
    """Every action name the signed-in user can see, for the filter menu."""
    conditions, params = _scope(request)
    where = sql.SQL(" WHERE ") + sql.SQL(" AND ").join(conditions) if conditions else sql.SQL("")
    with transaction() as cur:
        query = sql.SQL("SELECT DISTINCT l.action FROM audit_log l") + where + sql.SQL(" ORDER BY l.action")
        cur.execute(query, params)
        return ok({"items": [r["action"] for r in cur.fetchall()]})


def handler(event: dict | None = None, context: object = None) -> dict:
    """Lambda entry point."""
    return router.handle(event, context)
