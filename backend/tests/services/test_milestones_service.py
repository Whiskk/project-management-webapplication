"""Integration tests for milestones: dependencies, scheduling rules, status rules and tracking."""

import pytest

from conftest import bearer, load_service, make_event, response_json
from pm_core import db

pytestmark = pytest.mark.db

service = load_service("projects")


def call(method: str, path: str, as_: str = "MM4R8T", body: object = None) -> tuple[int, dict]:
    response = service.handler(make_event(method, f"/api/projects{path}", body=body, headers=bearer(as_)))
    return response["statusCode"], response_json(response)


def user_id(employee_id: str) -> int:
    with db.transaction() as cur:
        cur.execute("SELECT id FROM users WHERE employee_id = %s", (employee_id,))
        return cur.fetchone()["id"]


@pytest.fixture
def project(fresh_db: None) -> int:
    """A project running through November 2026, managed by MM4R8T."""
    status, body = call(
        "POST",
        "/",
        "AA7K2P",
        {
            "name": "Apollo",
            "budget": 100000,
            "manager_id": user_id("MM4R8T"),
            "start_date": "2026-11-02",
            "predicted_end_date": "2026-11-30",
        },
    )
    assert status == 201
    return body["id"]


def add(project: int, title: str, start: str, due: str, depends_on: list[int] | None = None, **extra: object) -> dict:
    status, body = call(
        "POST",
        f"/{project}/milestones",
        body={
            "title": title,
            "start_date": start,
            "due_date": due,
            "depends_on": depends_on or [],
            **extra,
        },
    )
    assert status == 201, body
    return body


def update(project: int, milestone: int, **fields: object) -> tuple[int, dict]:
    return call("PATCH", f"/{project}/milestones/{milestone}", body=fields)


def last_audit() -> dict:
    with db.transaction() as cur:
        cur.execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT 1")
        return cur.fetchone()


# ------------------------------------------------------------------ creating and listing


def test_create_and_list_with_dependencies(project: int) -> None:
    design = add(project, "Design", "2026-11-02", "2026-11-06")
    build = add(project, "Build", "2026-11-09", "2026-11-20", [design["id"]])
    assert build["depends_on"] == [{"id": design["id"], "title": "Design"}]
    assert (build["blocked_by"], build["can_start"]) == (["Design"], False)

    status, body = call("GET", f"/{project}/milestones")
    assert status == 200
    assert [m["title"] for m in body["items"]] == ["Design", "Build"]
    assert body["items"][0]["dependents"] == [{"id": build["id"], "title": "Build"}]
    assert body["summary"] == {
        "total": 2,
        "completed": 0,
        "overdue": 0,
        "percent_complete": 0,
        "tasks_total": 0,
        "tasks_done": 0,
    }
    entry = last_audit()
    assert (entry["action"], entry["project_id"]) == ("milestone.create", project)


def test_team_members_can_view_but_not_edit(project: int) -> None:
    with db.transaction() as cur:
        cur.execute(
            "INSERT INTO project_assignments (project_id, user_id, hours_per_week) VALUES (%s, %s, 5)",
            (project, user_id("EE3H9W")),
        )
    add(project, "Design", "2026-11-02", "2026-11-06")
    assert call("GET", f"/{project}/milestones", "EE3H9W")[0] == 200
    assert (
        call(
            "POST",
            f"/{project}/milestones",
            "EE3H9W",
            {"title": "x", "start_date": "2026-11-02", "due_date": "2026-11-03"},
        )[0]
        == 403
    )


def test_other_managers_cannot_edit_and_are_audited(project: int) -> None:
    with db.transaction() as cur:
        cur.execute(
            "INSERT INTO users (employee_id, first_name, last_name, email, role, password_hash) "
            "VALUES ('MGR002', 'Other', 'Manager', 'o@example.com', 'manager', 'x')"
        )
    status, _ = call(
        "POST", f"/{project}/milestones", "MGR002", {"title": "x", "start_date": "2026-11-02", "due_date": "2026-11-03"}
    )
    assert status == 403
    assert last_audit()["outcome"] == "denied"


# ------------------------------------------------------------------ dates


def test_due_date_must_follow_start_date(project: int) -> None:
    status, body = call(
        "POST",
        f"/{project}/milestones",
        body={"title": "Backwards", "start_date": "2026-11-10", "due_date": "2026-11-09"},
    )
    assert (status, body["error"]["details"]["due_date"]) == (400, "Must be on or after the start date")


def test_cannot_start_before_project(project: int) -> None:
    status, body = call(
        "POST", f"/{project}/milestones", body={"title": "Early", "start_date": "2026-10-30", "due_date": "2026-11-03"}
    )
    assert status == 400
    assert "project start (2026-11-02)" in body["error"]["details"]["start_date"]


def test_due_after_project_end_is_allowed_but_flagged(project: int) -> None:
    late = add(project, "Late", "2026-11-20", "2026-12-10")
    assert late["past_project_end"] is True


def test_cannot_start_before_dependency_is_due(project: int) -> None:
    design = add(project, "Design", "2026-11-02", "2026-11-10")
    status, body = call(
        "POST",
        f"/{project}/milestones",
        body={"title": "Build", "start_date": "2026-11-09", "due_date": "2026-11-20", "depends_on": [design["id"]]},
    )
    assert status == 400
    assert body["error"]["details"]["start_date"] == "Must be on or after 2026-11-10, when 'Design' is due"


def test_moving_due_date_past_a_dependents_start_is_refused(project: int) -> None:
    design = add(project, "Design", "2026-11-02", "2026-11-06")
    add(project, "Build", "2026-11-09", "2026-11-20", [design["id"]])
    status, body = update(project, design["id"], due_date="2026-11-12")
    assert status == 409
    assert "'Build' depends on 'Design'" in body["error"]["message"]
    assert update(project, design["id"], due_date="2026-11-09")[0] == 200  # same day is fine


# ------------------------------------------------------------------ dependencies


def test_dependencies_must_be_in_the_same_project(project: int) -> None:
    _, other = call(
        "POST",
        "/",
        "AA7K2P",
        {
            "name": "Other",
            "budget": 1,
            "manager_id": user_id("MM4R8T"),
            "start_date": "2026-11-02",
            "predicted_end_date": "2026-11-30",
        },
    )
    foreign = add(other["id"], "Foreign", "2026-11-02", "2026-11-03")
    status, body = call(
        "POST",
        f"/{project}/milestones",
        body={"title": "x", "start_date": "2026-11-05", "due_date": "2026-11-06", "depends_on": [foreign["id"]]},
    )
    assert (status, body["error"]["details"]["depends_on"]) == (400, "Dependencies must be milestones of this project")


@pytest.mark.parametrize("bad", ["1", [True], ["a"], {"id": 1}])
def test_dependency_list_is_validated(project: int, bad: object) -> None:
    status, _ = call(
        "POST",
        f"/{project}/milestones",
        body={"title": "x", "start_date": "2026-11-05", "due_date": "2026-11-06", "depends_on": bad},
    )
    assert status == 400


def test_cannot_depend_on_itself(project: int) -> None:
    design = add(project, "Design", "2026-11-02", "2026-11-06")
    status, body = update(project, design["id"], depends_on=[design["id"]])
    assert (status, body["error"]["details"]["depends_on"]) == (400, "A milestone cannot depend on itself")


def test_circular_dependencies_are_refused(project: int) -> None:
    a = add(project, "A", "2026-11-02", "2026-11-02")
    b = add(project, "B", "2026-11-03", "2026-11-03", [a["id"]])
    c = add(project, "C", "2026-11-04", "2026-11-04", [b["id"]])
    status, body = update(project, a["id"], depends_on=[c["id"]])
    assert status == 409
    assert body["error"]["message"] == "That would create a circular dependency: A → C → B → A"


def test_dependencies_can_be_replaced(project: int) -> None:
    a = add(project, "A", "2026-11-02", "2026-11-03")
    b = add(project, "B", "2026-11-02", "2026-11-03")
    c = add(project, "C", "2026-11-04", "2026-11-05", [a["id"]])
    status, body = update(project, c["id"], depends_on=[b["id"]])
    assert status == 200
    assert body["depends_on"] == [{"id": b["id"], "title": "B"}]
    assert last_audit()["changes"]["depends_on"] == {"from": [a["id"]], "to": [b["id"]]}


# ------------------------------------------------------------------ status


def test_cannot_start_until_dependencies_are_completed(project: int) -> None:
    design = add(project, "Design", "2026-11-02", "2026-11-06")
    build = add(project, "Build", "2026-11-09", "2026-11-20", [design["id"]])
    status, body = update(project, build["id"], status="in_progress")
    assert status == 409
    assert body["error"]["message"] == "Cannot mark as in progress until these are completed: Design"

    status, done = update(project, design["id"], status="completed")
    assert (status, done["completed_at"] is not None) == (200, True)
    status, body = update(project, build["id"], status="in_progress")
    assert (status, body["can_start"]) == (200, True)


def test_cannot_reopen_while_dependents_have_started(project: int) -> None:
    design = add(project, "Design", "2026-11-02", "2026-11-06")
    build = add(project, "Build", "2026-11-09", "2026-11-20", [design["id"]])
    update(project, design["id"], status="completed")
    update(project, build["id"], status="in_progress")
    status, body = update(project, design["id"], status="in_progress")
    assert status == 409
    assert "work that depends on it has already started (Build)" in body["error"]["message"]

    update(project, build["id"], status="not_started")
    status, reopened = update(project, design["id"], status="in_progress")
    assert (status, reopened["completed_at"]) == (200, None)


def test_blocked_status_can_be_set_manually(project: int) -> None:
    design = add(project, "Design", "2026-11-02", "2026-11-06")
    assert update(project, design["id"], status="blocked")[1]["status"] == "blocked"


# ------------------------------------------------------------------ tracking


def test_overdue_and_progress_tracking(project: int) -> None:
    with db.transaction() as cur:  # move the project into the past so milestones can be overdue
        cur.execute("UPDATE projects SET start_date = '2020-01-01' WHERE id = %s", (project,))
    done = add(project, "Done", "2020-01-06", "2020-01-10", status="completed")
    add(project, "Late", "2020-01-13", "2020-01-17")
    _, body = call("GET", f"/{project}/milestones")
    flags = {m["title"]: m["overdue"] for m in body["items"]}
    assert flags == {"Done": False, "Late": True}
    assert body["summary"] == {
        "total": 2,
        "completed": 1,
        "overdue": 1,
        "percent_complete": 50,
        "tasks_total": 0,
        "tasks_done": 0,
    }
    assert done["completed_at"] is not None


# ------------------------------------------------------------------ delete / archive


def test_cannot_delete_a_milestone_others_depend_on(project: int) -> None:
    design = add(project, "Design", "2026-11-02", "2026-11-06")
    build = add(project, "Build", "2026-11-09", "2026-11-20", [design["id"]])
    status, body = call("DELETE", f"/{project}/milestones/{design['id']}")
    assert status == 409
    assert "Build depend(s) on it" in body["error"]["message"]

    assert call("DELETE", f"/{project}/milestones/{build['id']}")[0] == 204
    assert call("DELETE", f"/{project}/milestones/{design['id']}")[0] == 204
    assert last_audit()["action"] == "milestone.delete"
    assert call("DELETE", f"/{project}/milestones/{design['id']}")[0] == 404


def test_archived_project_milestones_are_read_only(project: int) -> None:
    design = add(project, "Design", "2026-11-02", "2026-11-06")
    call("POST", f"/{project}/archive", "AA7K2P")
    assert update(project, design["id"], title="x")[0] == 409
    assert call("GET", f"/{project}/milestones", "AA7K2P")[0] == 200


def test_unchanged_update_is_not_audited(project: int) -> None:
    design = add(project, "Design", "2026-11-02", "2026-11-06")
    update(project, design["id"], title="Design")
    assert last_audit()["action"] == "milestone.create"
