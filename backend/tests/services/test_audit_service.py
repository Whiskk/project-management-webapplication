"""Integration tests for the read-only audit service."""

import csv
import io
import json

import pytest

from conftest import bearer, load_service, make_event, response_json
from pm_core import audit, db
from pm_core.audit import Actor

pytestmark = pytest.mark.db

service = load_service("audit")

ADMIN = Actor(id=1, employee_id="AA7K2P", name="Alex Admin", role="admin")
MANAGER = Actor(id=2, employee_id="MM4R8T", name="Morgan Manager", role="manager")


def call(path: str, as_: str = "AA7K2P", query: dict | None = None, method: str = "GET") -> tuple[int, dict]:
    response = service.handler(make_event(method, f"/api/audit{path}", headers=bearer(as_), query=query))
    return response["statusCode"], response_json(response)


@pytest.fixture
def entries(fresh_db: None) -> None:
    with db.transaction() as cur:
        cur.execute(
            "INSERT INTO projects (name, start_date, predicted_end_date, manager_id, budget) "
            "VALUES ('Apollo', '2026-11-02', '2026-11-30', 2, 1000)"
        )
        audit.record(
            cur, ADMIN, "project.create", "project", 1, "Created project Apollo", after={"name": "Apollo"}, project_id=1
        )
        audit.record(
            cur, MANAGER, "milestone.create", "milestone", 1, "Added milestone 'Design' to Apollo", project_id=1
        )
        audit.record(
            cur,
            ADMIN,
            "user.update",
            "user",
            3,
            "Updated Eli Employee (EE3H9W): job_title",
            before={"job_title": "Engineer"},
            after={"job_title": "Lead"},
        )
        audit.record(
            cur,
            None,
            "auth.login",
            "user",
            None,
            "Failed sign-in for NOPE01",
            outcome="denied",
            actor_employee_id="NOPE01",
        )


def summaries(body: dict) -> list[str]:
    return [item["summary"] for item in body["items"]]


def test_admin_lists_newest_first_with_project_names(entries: None) -> None:
    status, body = call("/")
    assert status == 200
    assert body["total"] == 4
    assert body["items"][0]["summary"] == "Failed sign-in for NOPE01"
    created = next(i for i in body["items"] if i["action"] == "project.create")
    assert (created["project_name"], created["changes"]) == ("Apollo", {"name": {"from": None, "to": "Apollo"}})


def test_employees_cannot_read_the_audit_log(entries: None) -> None:
    assert call("/", "EE3H9W")[0] == 403
    assert call("/actions", "EE3H9W")[0] == 403


# --- Managers: their own entries and their direct reports' only -------------

ELI = Actor(id=3, employee_id="EE3H9W", name="Eli Employee", role="employee")
OTHER_MANAGER = Actor(id=4, employee_id="OM1234", name="Olga Other", role="manager")
OTHER_EMPLOYEE = Actor(id=5, employee_id="OE1234", name="Owen Other", role="employee")
SUB_MANAGER = Actor(id=6, employee_id="SM1234", name="Sam Sub", role="manager")


@pytest.fixture
def team_entries(entries: None) -> None:
    """Another team (Olga + Owen), a manager reporting to Morgan (Sam), and entries by everyone."""
    with db.transaction() as cur:
        for actor, manager_id in ((OTHER_MANAGER, None), (OTHER_EMPLOYEE, 4), (SUB_MANAGER, 2)):
            first, last = actor.name.split()
            cur.execute(
                "INSERT INTO users (id, employee_id, first_name, last_name, email, role, manager_id, password_hash) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, 'x')",
                (actor.id, actor.employee_id, first, last, f"{first.lower()}@example.com", actor.role, manager_id),
            )
        cur.execute("SELECT setval('users_id_seq', (SELECT max(id) FROM users))")
        audit.record(cur, ELI, "user.update_self", "user", 3, "Eli Employee updated their profile (email)")
        audit.record(
            cur,
            ELI,
            "access.denied",
            "project",
            1,
            "Denied POST /projects/1/milestones",
            outcome="denied",
            project_id=1,
        )
        audit.record(cur, OTHER_MANAGER, "project.update", "project", 1, "Olga Other updated Apollo", project_id=1)
        audit.record(cur, OTHER_EMPLOYEE, "user.update_self", "user", 5, "Owen Other updated their profile (email)")
        audit.record(cur, SUB_MANAGER, "milestone.update", "milestone", 1, "Sam Sub updated milestone 'Design'")
        for target_id, employee_id in ((3, "EE3H9W"), (2, "MM4R8T"), (5, "OE1234")):
            audit.record(
                cur,
                None,
                "auth.login",
                "user",
                target_id,
                f"Failed sign-in for {employee_id} (invalid credentials)",
                outcome="denied",
                actor_employee_id=employee_id,
            )


MORGAN_SEES = [
    "Failed sign-in for MM4R8T (invalid credentials)",
    "Failed sign-in for EE3H9W (invalid credentials)",
    "Denied POST /projects/1/milestones",
    "Eli Employee updated their profile (email)",
    "Added milestone 'Design' to Apollo",
]


def test_manager_sees_own_and_direct_reports_entries_only(team_entries: None) -> None:
    status, body = call("/", "MM4R8T", query={"page_size": "100"})
    assert status == 200
    assert summaries(body) == MORGAN_SEES
    assert body["total"] == len(MORGAN_SEES)


def test_manager_never_sees_admins_other_managers_or_other_teams(team_entries: None) -> None:
    seen = " | ".join(summaries(call("/", "MM4R8T", query={"page_size": "100"})[1]))
    for hidden in (
        "Created project Apollo",  # admin
        "Updated Eli Employee",  # admin acting on Morgan's report is still an admin entry
        "Olga Other",  # another manager
        "Owen Other",  # another manager's employee
        "Sam Sub",  # reports to Morgan, but is a manager
        "OE1234",  # failed sign-in on another team's account
        "NOPE01",  # failed sign-in for an unknown id
    ):
        assert hidden not in seen


def test_the_other_manager_sees_only_their_own_team(team_entries: None) -> None:
    _, body = call("/", "OM1234", query={"page_size": "100"})
    assert summaries(body) == [
        "Failed sign-in for OE1234 (invalid credentials)",
        "Owen Other updated their profile (email)",
        "Olga Other updated Apollo",
    ]


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ({"role": "admin"}, []),
        ({"role": "employee"}, ["Denied POST /projects/1/milestones", "Eli Employee updated their profile (email)"]),
        ({"actor": "om1234"}, []),
        ({"outcome": "denied"}, MORGAN_SEES[:3]),
        ({"project_id": "1"}, ["Denied POST /projects/1/milestones", "Added milestone 'Design' to Apollo"]),
        ({"q": "apollo"}, ["Added milestone 'Design' to Apollo"]),
    ],
)
def test_manager_filters_stay_within_scope(team_entries: None, query: dict, expected: list[str]) -> None:
    assert summaries(call("/", "MM4R8T", query=query)[1]) == expected


def test_manager_pagination_counts_only_visible_entries(team_entries: None) -> None:
    _, page2 = call("/", "MM4R8T", query={"page": "2", "page_size": "3"})
    assert (page2["total"], summaries(page2)) == (5, MORGAN_SEES[3:])


def test_reassigning_a_report_moves_their_history_to_the_new_manager(team_entries: None) -> None:
    with db.transaction() as cur:
        cur.execute("UPDATE users SET manager_id = 4 WHERE id = 3")
    assert "Eli Employee updated their profile (email)" not in summaries(call("/", "MM4R8T")[1])
    assert "Eli Employee updated their profile (email)" in summaries(call("/", "OM1234")[1])


def test_manager_actions_menu_lists_only_visible_actions(team_entries: None) -> None:
    _, body = call("/actions", "MM4R8T")
    assert body["items"] == ["access.denied", "auth.login", "milestone.create", "user.update_self"]


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ({"actor": "mm4r8t"}, ["Added milestone 'Design' to Apollo"]),
        ({"role": "admin"}, ["Updated Eli Employee (EE3H9W): job_title", "Created project Apollo"]),
        ({"action": "user.update"}, ["Updated Eli Employee (EE3H9W): job_title"]),
        ({"outcome": "denied"}, ["Failed sign-in for NOPE01"]),
        ({"project_id": "1"}, ["Added milestone 'Design' to Apollo", "Created project Apollo"]),
        ({"entity_type": "milestone"}, ["Added milestone 'Design' to Apollo"]),
        ({"q": "design"}, ["Added milestone 'Design' to Apollo"]),
        ({"q": "nope01"}, ["Failed sign-in for NOPE01"]),
    ],
)
def test_filters(entries: None, query: dict, expected: list[str]) -> None:
    status, body = call("/", query=query)
    assert (status, summaries(body)) == (200, expected)


def test_date_range_is_inclusive_of_the_to_day(entries: None) -> None:
    with db.transaction() as cur:
        cur.execute("SELECT CURRENT_DATE::text AS today")
        today = cur.fetchone()["today"]
    assert call("/", query={"from": today, "to": today})[1]["total"] == 4
    assert call("/", query={"to": "2020-01-01"})[1]["total"] == 0


@pytest.mark.parametrize(
    "query",
    [
        {"from": "13/10/2026"},
        {"from": "2026-10-14", "to": "2026-10-01"},
        {"role": "boss"},
        {"outcome": "maybe"},
        {"project_id": "abc"},
        {"page_size": "500"},
    ],
)
def test_invalid_filters_are_rejected(entries: None, query: dict) -> None:
    assert call("/", query=query)[0] == 400


def test_pagination(entries: None) -> None:
    _, page2 = call("/", query={"page": "2", "page_size": "3"})
    assert (page2["total"], len(page2["items"])) == (4, 1)


def test_actions_menu(entries: None) -> None:
    _, body = call("/actions")
    assert body["items"] == ["auth.login", "milestone.create", "project.create", "user.update"]


@pytest.mark.parametrize("method", ["POST", "PATCH", "PUT", "DELETE"])
def test_there_are_no_write_routes(entries: None, method: str) -> None:
    assert call("/", method=method)[0] == 405


# ------------------------------------------------------------------ CSV export


def export(as_: str = "AA7K2P", query: dict | None = None) -> tuple[dict, list[list[str]]]:
    response = service.handler(make_event("GET", "/api/audit/export", headers=bearer(as_), query=query))
    rows = list(csv.reader(io.StringIO(response.get("body", ""))))
    return response, rows


def test_export_is_a_csv_download_of_the_filtered_entries(entries: None) -> None:
    response, rows = export(query={"project_id": "1"})
    assert response["statusCode"] == 200
    assert response["headers"]["Content-Type"] == "text/csv; charset=utf-8"
    assert response["headers"]["Content-Disposition"].startswith('attachment; filename="audit-log-')
    header, *data = rows
    assert header[:3] == ["Time (UTC)", "Employee ID", "Name"]
    summary = header.index("Summary")
    assert [row[summary] for row in data] == ["Added milestone 'Design' to Apollo", "Created project Apollo"]
    assert data[1][header.index("Project")] == "Apollo"
    assert json.loads(data[1][header.index("Changes")]) == {"name": {"from": None, "to": "Apollo"}}


def test_export_keeps_the_manager_scope(team_entries: None) -> None:
    _, (header, *data) = export("MM4R8T")
    assert [row[header.index("Summary")] for row in data] == MORGAN_SEES


def test_export_refuses_employees_and_bad_filters(entries: None) -> None:
    assert export("EE3H9W")[0]["statusCode"] == 403
    assert export(query={"from": "2026-11-02", "to": "2026-11-01"})[0]["statusCode"] == 400


def test_export_neutralises_spreadsheet_formulas(fresh_db: None) -> None:
    with db.transaction() as cur:
        audit.record(cur, ADMIN, "project.create", "project", 1, '=HYPERLINK("http://evil","click")')
    _, (header, row) = export()
    assert row[header.index("Summary")] == '\'=HYPERLINK("http://evil","click")'
