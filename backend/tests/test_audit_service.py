"""Integration tests for the read-only audit service."""

import pytest

from conftest import bearer, load_service, make_event, response_json
from pm_core import audit, db
from pm_core.audit import Actor

pytestmark = pytest.mark.db

service = load_service("audit")

ADMIN = Actor(id=1, employee_id="ADM001", name="Alex Admin", role="admin")
MANAGER = Actor(id=2, employee_id="MGR001", name="Morgan Manager", role="manager")


def call(path: str, as_: str = "ADM001", query: dict | None = None, method: str = "GET") -> tuple[int, dict]:
    response = service.handler(make_event(method, f"/api/audit{path}", headers=bearer(as_), query=query))
    return response["statusCode"], response_json(response)


@pytest.fixture
def entries(fresh_db: None) -> None:
    with db.transaction() as cur:
        cur.execute(
            "INSERT INTO projects (name, start_date, predicted_end_date, manager_id, budget) "
            "VALUES ('Apollo', '2026-11-02', '2026-11-30', 2, 1000)"
        )
        audit.record(cur, ADMIN, "project.create", "project", 1, "Created project Apollo",
                     after={"name": "Apollo"}, project_id=1)
        audit.record(cur, MANAGER, "milestone.create", "milestone", 1, "Added milestone 'Design' to Apollo",
                     project_id=1)
        audit.record(cur, ADMIN, "user.update", "user", 3, "Updated Eli Employee (EMP001): job_title",
                     before={"job_title": "Engineer"}, after={"job_title": "Lead"})
        audit.record(cur, None, "auth.login", "user", None, "Failed sign-in for NOPE01",
                     outcome="denied", actor_employee_id="NOPE01")


def summaries(body: dict) -> list[str]:
    return [item["summary"] for item in body["items"]]


def test_admin_lists_newest_first_with_project_names(entries: None) -> None:
    status, body = call("/")
    assert status == 200
    assert body["total"] == 4
    assert body["items"][0]["summary"] == "Failed sign-in for NOPE01"
    created = next(i for i in body["items"] if i["action"] == "project.create")
    assert (created["project_name"], created["changes"]) == ("Apollo", {"name": {"from": None, "to": "Apollo"}})


@pytest.mark.parametrize("as_", ["MGR001", "EMP001"])
def test_only_admins_can_read_the_audit_log(entries: None, as_: str) -> None:
    assert call("/", as_)[0] == 403
    assert call("/actions", as_)[0] == 403


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ({"actor": "mgr001"}, ["Added milestone 'Design' to Apollo"]),
        ({"role": "admin"}, ["Updated Eli Employee (EMP001): job_title", "Created project Apollo"]),
        ({"action": "user.update"}, ["Updated Eli Employee (EMP001): job_title"]),
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
    [{"from": "13/10/2026"}, {"from": "2026-10-14", "to": "2026-10-01"}, {"role": "boss"}, {"outcome": "maybe"},
     {"project_id": "abc"}, {"page_size": "500"}],
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
