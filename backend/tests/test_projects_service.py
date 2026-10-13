"""Integration tests for project CRUD, visibility and archiving."""

import pytest

from conftest import bearer, load_service, make_event, response_json
from pm_core import db

pytestmark = pytest.mark.db

service = load_service("projects")


def call(method: str, path: str, as_: str, body: object = None, query: dict | None = None) -> tuple[int, dict]:
    event = make_event(method, f"/api/projects{path}", body=body, headers=bearer(as_), query=query)
    response = service.handler(event)
    return response["statusCode"], response_json(response)


def user_id(employee_id: str) -> int:
    with db.transaction() as cur:
        cur.execute("SELECT id FROM users WHERE employee_id = %s", (employee_id,))
        return cur.fetchone()["id"]


def project_body(**overrides: object) -> dict:
    return {
        "name": "Apollo",
        "description": "Customer portal rebuild",
        "start_date": "2026-11-02",
        "predicted_end_date": "2026-11-13",
        "budget": 50000,
        "manager_id": user_id("MGR001"),
        **overrides,
    }


def create(**overrides: object) -> dict:
    status, body = call("POST", "/", "ADM001", project_body(**overrides))
    assert status == 201, body
    return body


def add_manager(employee_id: str = "MGR002") -> int:
    with db.transaction() as cur:
        cur.execute(
            "INSERT INTO users (employee_id, first_name, last_name, email, role, password_hash) "
            "VALUES (%s, 'Other', 'Manager', %s, 'manager', 'x') RETURNING id",
            (employee_id, f"{employee_id.lower()}@example.com"),
        )
        return cur.fetchone()["id"]


def assign(project_id: int, employee_id: str = "EMP001") -> None:
    with db.transaction() as cur:
        cur.execute(
            "INSERT INTO project_assignments (project_id, user_id, hours_per_week) VALUES (%s, %s, 10)",
            (project_id, user_id(employee_id)),
        )


def last_audit() -> dict:
    with db.transaction() as cur:
        cur.execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT 1")
        return cur.fetchone()


# ------------------------------------------------------------------ create


def test_admin_creates_project_with_capacity(fresh_db: None) -> None:
    project = create()
    assert project["manager_name"] == "Morgan Manager"
    assert project["status"] == "planned"
    assert project["working_days"] == 10
    assert project["capacity_hours"] == 80
    assert project["budget"] == 50000.0
    entry = last_audit()
    assert (entry["action"], entry["project_id"]) == ("project.create", project["id"])


@pytest.mark.parametrize("as_", ["MGR001", "EMP001"])
def test_only_admins_create_projects(fresh_db: None, as_: str) -> None:
    assert call("POST", "/", as_, project_body())[0] == 403


def test_create_validates_dates_budget_and_manager(fresh_db: None) -> None:
    status, body = call("POST", "/", "ADM001", project_body(predicted_end_date="2026-11-01"))
    assert (status, body["error"]["details"]) == (400, {"predicted_end_date": "Must be on or after the start date"})

    status, body = call("POST", "/", "ADM001", project_body(budget=-5))
    assert body["error"]["details"]["budget"] == "Must be at least 0"

    status, body = call("POST", "/", "ADM001", project_body(manager_id=user_id("EMP001")))
    assert body["error"]["details"]["manager_id"] == "Must be an active manager"

    status, body = call("POST", "/", "ADM001", {})
    assert {"name", "start_date", "predicted_end_date", "budget", "manager_id"} <= set(body["error"]["details"])


# ------------------------------------------------------------------ visibility


def test_visibility_by_role(fresh_db: None) -> None:
    mine = create(name="Mine")
    other_manager = add_manager()
    theirs = create(name="Theirs", manager_id=other_manager)
    assign(theirs["id"])

    _, as_admin = call("GET", "/", "ADM001")
    assert {p["name"] for p in as_admin["items"]} == {"Mine", "Theirs"}

    _, as_manager = call("GET", "/", "MGR001")
    assert [p["name"] for p in as_manager["items"]] == ["Mine"]
    assert call("GET", f"/{theirs['id']}", "MGR001")[0] == 404

    _, as_employee = call("GET", "/", "EMP001")
    assert [p["name"] for p in as_employee["items"]] == ["Theirs"]
    assert as_employee["items"][0]["budget"] is None
    assert call("GET", f"/{mine['id']}", "EMP001")[0] == 404


def test_list_filters_and_search(fresh_db: None) -> None:
    create(name="Apollo", status="active")
    create(name="Gemini", description="Payments", status="planned")
    _, body = call("GET", "/", "ADM001", query={"q": "payments"})
    assert [p["name"] for p in body["items"]] == ["Gemini"]
    _, body = call("GET", "/", "ADM001", query={"status": "active"})
    assert [p["name"] for p in body["items"]] == ["Apollo"]
    _, body = call("GET", "/", "ADM001", query={"page_size": "1"})
    assert (body["total"], len(body["items"])) == (2, 1)
    assert call("GET", "/", "ADM001", query={"status": "done"})[0] == 400


# ------------------------------------------------------------------ update


def test_manager_updates_own_project_schedule_and_budget(fresh_db: None) -> None:
    project = create()
    status, body = call(
        "PATCH", f"/{project['id']}", "MGR001",
        {"budget": 60000, "predicted_end_date": "2026-11-20", "status": "active"},
    )
    assert status == 200
    assert (body["budget"], body["working_days"], body["status"]) == (60000.0, 15, "active")
    entry = last_audit()
    assert entry["action"] == "project.update"
    assert set(entry["changes"]) == {"budget", "predicted_end_date", "status"}


@pytest.mark.parametrize("field", [{"name": "Renamed"}, {"manager_id": 1}])
def test_manager_cannot_change_name_or_manager(fresh_db: None, field: dict) -> None:
    project = create()
    status, body = call("PATCH", f"/{project['id']}", "MGR001", field)
    assert status == 400
    assert body["error"]["details"][next(iter(field))] == "Unknown field"


def test_manager_editing_someone_elses_project_is_denied_and_audited(fresh_db: None) -> None:
    project = create(manager_id=add_manager())
    status, _ = call("PATCH", f"/{project['id']}", "MGR001", {"budget": 1})
    assert status == 403
    entry = last_audit()
    assert (entry["outcome"], entry["actor_employee_id"], entry["project_id"]) == ("denied", "MGR001", project["id"])


def test_employee_cannot_update(fresh_db: None) -> None:
    project = create()
    assert call("PATCH", f"/{project['id']}", "EMP001", {"budget": 1})[0] == 403


def test_admin_reassigns_manager(fresh_db: None) -> None:
    project = create()
    new_manager = add_manager()
    status, body = call("PATCH", f"/{project['id']}", "ADM001", {"manager_id": new_manager})
    assert (status, body["manager_employee_id"]) == (200, "MGR002")
    assert call("GET", f"/{project['id']}", "MGR001")[0] == 404


def test_update_keeps_dates_consistent(fresh_db: None) -> None:
    project = create()
    status, body = call("PATCH", f"/{project['id']}", "ADM001", {"start_date": "2026-12-01"})
    assert status == 400
    assert body["error"]["details"]["predicted_end_date"] == "Must be on or after the start date"


def test_unchanged_update_is_not_audited(fresh_db: None) -> None:
    project = create()
    call("PATCH", f"/{project['id']}", "ADM001", {"name": "Apollo"})
    assert last_audit()["action"] == "project.create"


def test_missing_project_is_404(fresh_db: None) -> None:
    assert call("PATCH", "/9999", "ADM001", {"budget": 1})[0] == 404
    assert call("GET", "/9999", "ADM001")[0] == 404


# ------------------------------------------------------------------ archive / reactivate


def test_archive_hides_project_and_makes_it_read_only(fresh_db: None) -> None:
    project = create()
    assign(project["id"])
    status, body = call("POST", f"/{project['id']}/archive", "ADM001")
    assert (status, body["is_archived"]) == (200, True)
    assert body["archived_at"] is not None
    assert last_audit()["action"] == "project.archive"

    _, listed = call("GET", "/", "ADM001")
    assert listed["total"] == 0
    _, listed = call("GET", "/", "ADM001", query={"archived": "true"})
    assert listed["total"] == 1
    assert call("GET", f"/{project['id']}", "EMP001")[0] == 404  # employees never see archived work

    status, body = call("PATCH", f"/{project['id']}", "ADM001", {"budget": 1})
    assert status == 409
    assert call("POST", f"/{project['id']}/archive", "ADM001")[0] == 409


def test_archive_is_admin_only(fresh_db: None) -> None:
    project = create()
    assert call("POST", f"/{project['id']}/archive", "MGR001")[0] == 403


def test_archived_project_is_kept_in_database(fresh_db: None) -> None:
    project = create()
    call("POST", f"/{project['id']}/archive", "ADM001")
    with db.transaction() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM projects")
        assert cur.fetchone()["n"] == 1


def test_reactivate_restores_project(fresh_db: None) -> None:
    project = create()
    call("POST", f"/{project['id']}/archive", "ADM001")
    status, body = call("POST", f"/{project['id']}/reactivate", "ADM001")
    assert (status, body["is_archived"], body["archived_at"]) == (200, False, None)
    assert last_audit()["action"] == "project.reactivate"
    assert call("POST", f"/{project['id']}/reactivate", "ADM001")[0] == 409


def test_reactivate_requires_active_manager(fresh_db: None) -> None:
    other = add_manager()
    project = create(manager_id=other)
    call("POST", f"/{project['id']}/archive", "ADM001")
    with db.transaction() as cur:
        cur.execute("UPDATE users SET is_active = FALSE WHERE id = %s", (other,))

    status, body = call("POST", f"/{project['id']}/reactivate", "ADM001")
    assert status == 409
    assert "Choose a new manager" in body["error"]["message"]

    status, body = call("POST", f"/{project['id']}/reactivate", "ADM001", {"manager_id": user_id("MGR001")})
    assert (status, body["manager_employee_id"]) == (200, "MGR001")
