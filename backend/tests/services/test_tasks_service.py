"""Integration tests for tasks: assignment rules, who can tick them off, and how they interact with milestones."""

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


def add_user(employee_id: str, first: str, role: str, manager: str | None) -> int:
    with db.transaction() as cur:
        cur.execute(
            "INSERT INTO users (employee_id, first_name, last_name, email, role, salary, manager_id, password_hash) "
            "VALUES (%s, %s, 'Test', %s, %s, 52000, %s, 'x') RETURNING id",
            (employee_id, first, f"{first.lower()}@example.com", role, user_id(manager) if manager else None),
        )
        return cur.fetchone()["id"]


def audits(action: str) -> list[dict]:
    with db.transaction() as cur:
        cur.execute("SELECT * FROM audit_log WHERE action = %s ORDER BY id", (action,))
        return cur.fetchall()


@pytest.fixture
def setup(fresh_db: None) -> dict:
    """
    Apollo (Nov 2026, managed by Morgan) with milestones Design and Build (Build depends on Design).

    Team: Eli and Tia (Morgan's reports, approved). Pia reports to another manager, so her
    hours are still pending approval. Owen is one of Morgan's reports but not on the project.
    """
    tia = add_user("TT2345", "Tia", "employee", "MM4R8T")
    owen = add_user("OO2345", "Owen", "employee", "MM4R8T")
    add_user("GG2345", "Olga", "manager", None)
    pia = add_user("PP2345", "Pia", "employee", "GG2345")
    eli = user_id("EE3H9W")
    status, project = call(
        "POST",
        "/",
        "AA7K2P",
        {
            "name": "Apollo",
            "budget": 1000000,
            "manager_id": user_id("MM4R8T"),
            "start_date": "2026-11-02",
            "predicted_end_date": "2026-11-30",
        },
    )
    assert status == 201, project
    pid = project["id"]
    for uid in (eli, tia, pia):
        assert call("POST", f"/{pid}/assignments", body={"user_id": uid, "hours_per_week": 5})[0] == 201
    _, design = call(
        "POST", f"/{pid}/milestones", body={"title": "Design", "start_date": "2026-11-02", "due_date": "2026-11-06"}
    )
    _, build = call(
        "POST",
        f"/{pid}/milestones",
        body={"title": "Build", "start_date": "2026-11-09", "due_date": "2026-11-20", "depends_on": [design["id"]]},
    )
    return {
        "project": pid,
        "design": design["id"],
        "build": build["id"],
        "eli": eli,
        "tia": tia,
        "owen": owen,
        "pia": pia,
    }


def add_task(s: dict, milestone: str = "design", as_: str = "MM4R8T", **body: object) -> tuple[int, dict]:
    return call("POST", f"/{s['project']}/milestones/{s[milestone]}/tasks", as_, {"title": "Wireframes", **body})


def milestone(s: dict, key: str, as_: str = "MM4R8T") -> dict:
    _, body = call("GET", f"/{s['project']}/milestones", as_)
    return next(m for m in body["items"] if m["id"] == s[key])


# ------------------------------------------------------------------ creating and listing


def test_manager_adds_an_assigned_task_and_it_is_listed_with_its_milestone(setup: dict) -> None:
    status, task = add_task(setup, assignee_id=setup["eli"], description="Low fidelity first")
    assert status == 201
    assert task["assignee"] == {"id": setup["eli"], "name": "Eli Employee", "employee_id": "EE3H9W"}
    assert (task["done"], task["description"]) == (False, "Low fidelity first")
    design = milestone(setup, "design")
    assert (design["tasks_total"], design["tasks_done"]) == (1, 0)
    assert design["tasks"][0]["title"] == "Wireframes"
    entry = audits("task.create")[-1]
    assert entry["summary"] == "Added task 'Wireframes' to milestone 'Design' on Apollo (assigned to Eli Employee)"
    assert entry["project_id"] == setup["project"]


def test_tasks_can_be_unassigned(setup: dict) -> None:
    status, task = add_task(setup)
    assert (status, task["assignee"]) == (201, None)


def test_team_members_see_tasks_but_outsiders_do_not(setup: dict) -> None:
    add_task(setup, assignee_id=setup["eli"])
    assert milestone(setup, "design", "TT2345")["tasks_total"] == 1
    assert call("GET", f"/{setup['project']}/milestones", "OO2345")[0] == 404


@pytest.mark.parametrize("who", ["owen", "pia"])
def test_assignee_must_be_an_approved_team_member(setup: dict, who: str) -> None:
    status, body = add_task(setup, assignee_id=setup[who])
    assert status == 400
    assert body["error"]["details"] == {"assignee_id": "Must be an approved member of this project's team"}


@pytest.mark.parametrize(
    "body",
    [{"title": ""}, {"title": "x" * 201}, {"title": "Ok", "assignee_id": "eli"}, {"title": "Ok", "description": 5}],
)
def test_task_input_is_validated(setup: dict, body: dict) -> None:
    status, _ = call("POST", f"/{setup['project']}/milestones/{setup['design']}/tasks", body=body)
    assert status == 400


def test_only_the_project_manager_or_an_admin_can_add_tasks(setup: dict) -> None:
    assert add_task(setup, as_="AA7K2P")[0] == 201
    assert add_task(setup, as_="EE3H9W")[0] == 403
    assert add_task(setup, as_="GG2345")[0] == 403
    assert {e["actor_employee_id"] for e in audits("access.denied")} == {"EE3H9W", "GG2345"}


def test_unknown_milestone_or_task_is_404(setup: dict) -> None:
    assert call("POST", f"/{setup['project']}/milestones/9999/tasks", body={"title": "x"})[0] == 404
    assert call("POST", f"/{setup['project']}/tasks/9999/complete")[0] == 404


# ------------------------------------------------------------------ ticking off


def test_the_assignee_ticks_their_task_off_and_can_undo_it(setup: dict) -> None:
    _, task = add_task(setup, assignee_id=setup["eli"])
    status, done = call("POST", f"/{setup['project']}/tasks/{task['id']}/complete", "EE3H9W")
    assert status == 200
    assert (done["done"], done["completed_by_name"]) == (True, "Eli Employee")
    assert milestone(setup, "design", "EE3H9W")["tasks_done"] == 1
    assert audits("task.complete")[-1]["summary"] == "Eli Employee completed task 'Wireframes' on Apollo"

    status, reopened = call("POST", f"/{setup['project']}/tasks/{task['id']}/reopen", "EE3H9W")
    assert (status, reopened["done"], reopened["completed_by_name"]) == (200, False, None)
    assert audits("task.reopen")[-1]["summary"] == "Eli Employee reopened task 'Wireframes' on Apollo"


def test_ticking_twice_changes_nothing(setup: dict) -> None:
    _, task = add_task(setup, assignee_id=setup["eli"])
    call("POST", f"/{setup['project']}/tasks/{task['id']}/complete", "EE3H9W")
    assert call("POST", f"/{setup['project']}/tasks/{task['id']}/complete", "EE3H9W")[0] == 200
    assert len(audits("task.complete")) == 1


def test_teammates_cannot_tick_someone_elses_task_and_are_audited(setup: dict) -> None:
    _, task = add_task(setup, assignee_id=setup["eli"])
    _, unassigned = add_task(setup, title="Spare")
    assert call("POST", f"/{setup['project']}/tasks/{task['id']}/complete", "TT2345")[0] == 403
    assert call("POST", f"/{setup['project']}/tasks/{unassigned['id']}/complete", "TT2345")[0] == 403
    denied = audits("access.denied")
    assert len(denied) == 2 and all(e["actor_employee_id"] == "TT2345" for e in denied)
    assert milestone(setup, "design", "TT2345")["tasks"][0]["can_tick"] is False
    assert milestone(setup, "design", "EE3H9W")["tasks"][0]["can_tick"] is True


def test_the_manager_or_an_admin_can_tick_any_task(setup: dict) -> None:
    _, first = add_task(setup, assignee_id=setup["eli"])
    _, second = add_task(setup, title="Spare")
    assert call("POST", f"/{setup['project']}/tasks/{first['id']}/complete")[1]["completed_by_name"] == "Morgan Manager"
    assert call("POST", f"/{setup['project']}/tasks/{second['id']}/complete", "AA7K2P")[0] == 200


def test_people_outside_the_project_cannot_tick_tasks(setup: dict) -> None:
    _, task = add_task(setup, assignee_id=setup["eli"])
    assert call("POST", f"/{setup['project']}/tasks/{task['id']}/complete", "OO2345")[0] == 404
    assert call("POST", f"/{setup['project']}/tasks/{task['id']}/complete", "GG2345")[0] == 404


def test_tasks_wait_for_the_milestones_dependencies(setup: dict) -> None:
    _, task = add_task(setup, "build", assignee_id=setup["eli"], title="Implement API")
    assert milestone(setup, "build", "EE3H9W")["tasks"][0]["waiting_on"] == ["Design"]
    status, body = call("POST", f"/{setup['project']}/tasks/{task['id']}/complete", "EE3H9W")
    assert status == 409
    assert body["error"]["message"] == ("Tasks in 'Build' can't be ticked off until these are completed: Design")
    assert call("PATCH", f"/{setup['project']}/milestones/{setup['design']}", body={"status": "completed"})[0] == 200
    assert call("POST", f"/{setup['project']}/tasks/{task['id']}/complete", "EE3H9W")[0] == 200


# ------------------------------------------------------------------ milestones and tasks


def test_a_milestone_cannot_be_completed_while_tasks_are_open(setup: dict) -> None:
    _, task = add_task(setup, assignee_id=setup["eli"])
    status, body = call("PATCH", f"/{setup['project']}/milestones/{setup['design']}", body={"status": "completed"})
    assert status == 409
    assert body["error"]["message"].startswith("Cannot mark as completed: 1 task(s) still open")
    call("POST", f"/{setup['project']}/tasks/{task['id']}/complete", "EE3H9W")
    assert call("PATCH", f"/{setup['project']}/milestones/{setup['design']}", body={"status": "completed"})[0] == 200


def test_completed_milestones_take_no_new_or_reopened_tasks(setup: dict) -> None:
    _, task = add_task(setup, assignee_id=setup["eli"])
    call("POST", f"/{setup['project']}/tasks/{task['id']}/complete", "EE3H9W")
    call("PATCH", f"/{setup['project']}/milestones/{setup['design']}", body={"status": "completed"})

    status, body = add_task(setup, title="Late addition")
    assert (status, body["error"]["message"]) == (409, "'Design' is completed. Reopen it to add tasks.")
    status, body = call("POST", f"/{setup['project']}/tasks/{task['id']}/reopen", "EE3H9W")
    assert (status, body["error"]["message"]) == (409, "'Design' is completed. Reopen the milestone first.")

    call("PATCH", f"/{setup['project']}/milestones/{setup['design']}", body={"status": "in_progress"})
    assert call("POST", f"/{setup['project']}/tasks/{task['id']}/reopen", "EE3H9W")[0] == 200


def test_deleting_a_milestone_deletes_its_tasks(setup: dict) -> None:
    add_task(setup, "build", title="One")
    add_task(setup, "build", title="Two")
    assert call("DELETE", f"/{setup['project']}/milestones/{setup['build']}")[0] == 204
    with db.transaction() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM tasks")
        assert cur.fetchone()["n"] == 0
    assert audits("milestone.delete")[-1]["summary"] == "Deleted milestone 'Build' and its 2 task(s) from Apollo"


# ------------------------------------------------------------------ editing, deleting, staffing


def test_manager_renames_reassigns_and_unassigns_a_task(setup: dict) -> None:
    _, task = add_task(setup, assignee_id=setup["eli"])
    path = f"/{setup['project']}/tasks/{task['id']}"
    status, updated = call("PATCH", path, body={"title": "Wireframes v2", "assignee_id": setup["tia"]})
    assert (status, updated["title"], updated["assignee"]["name"]) == (200, "Wireframes v2", "Tia Test")
    entry = audits("task.update")[-1]
    assert entry["summary"] == "Updated task 'Wireframes v2' on Apollo: assignee, title"
    assert entry["changes"]["assignee"] == {"from": "EE3H9W", "to": "TT2345"}

    assert call("PATCH", path, body={"assignee_id": None})[1]["assignee"] is None
    assert call("PATCH", path, body={"assignee_id": setup["owen"]})[0] == 400
    assert call("PATCH", path, "EE3H9W", {"title": "Mine now"})[0] == 403


def test_manager_deletes_a_task(setup: dict) -> None:
    _, task = add_task(setup)
    assert call("DELETE", f"/{setup['project']}/tasks/{task['id']}")[0] == 204
    assert call("DELETE", f"/{setup['project']}/tasks/{task['id']}")[0] == 404
    assert audits("task.delete")[-1]["summary"] == "Deleted task 'Wireframes' from Apollo"


def test_removing_someone_from_the_project_unassigns_their_open_tasks(setup: dict) -> None:
    _, open_task = add_task(setup, assignee_id=setup["eli"], title="Open")
    _, done_task = add_task(setup, assignee_id=setup["eli"], title="Done")
    call("POST", f"/{setup['project']}/tasks/{done_task['id']}/complete", "EE3H9W")
    _, team = call("GET", f"/{setup['project']}/assignments")
    eli_assignment = next(a for a in team["items"] if a["user_id"] == setup["eli"])
    assert call("DELETE", f"/{setup['project']}/assignments/{eli_assignment['id']}")[0] == 204

    tasks = {t["title"]: t for t in milestone(setup, "design")["tasks"]}
    assert tasks["Open"]["assignee"] is None
    assert tasks["Done"]["assignee"]["name"] == "Eli Employee"  # who did the work is kept
    assert audits("assignment.delete")[-1]["summary"].endswith("; unassigned from 1 open task(s)")


def test_archived_projects_are_read_only(setup: dict) -> None:
    _, task = add_task(setup, assignee_id=setup["eli"])
    assert call("POST", f"/{setup['project']}/archive", "AA7K2P")[0] == 200
    assert add_task(setup, as_="AA7K2P")[0] == 409
    assert call("PATCH", f"/{setup['project']}/tasks/{task['id']}", "AA7K2P", {"title": "x"})[0] == 409
    assert call("DELETE", f"/{setup['project']}/tasks/{task['id']}", "AA7K2P")[0] == 409
    assert call("POST", f"/{setup['project']}/tasks/{task['id']}/complete", "AA7K2P")[0] == 409


def test_tasks_belong_to_their_own_project(setup: dict) -> None:
    _, task = add_task(setup)
    _, other = call(
        "POST",
        "/",
        "AA7K2P",
        {
            "name": "Gemini",
            "budget": 1000,
            "manager_id": user_id("MM4R8T"),
            "start_date": "2026-11-02",
            "predicted_end_date": "2026-11-30",
        },
    )
    assert call("POST", f"/{other['id']}/tasks/{task['id']}/complete")[0] == 404


# ------------------------------------------------------------------ dashboard


def test_employee_dashboard_lists_my_open_tasks(setup: dict) -> None:
    add_task(setup, assignee_id=setup["eli"], title="Wireframes")
    add_task(setup, "build", assignee_id=setup["eli"], title="Implement API")
    _, done = add_task(setup, assignee_id=setup["eli"], title="Kick-off notes")
    add_task(setup, assignee_id=setup["tia"], title="Someone else's")
    call("POST", f"/{setup['project']}/tasks/{done['id']}/complete", "EE3H9W")

    _, dashboard = call("GET", "/dashboard", "EE3H9W")
    tasks = dashboard["my_tasks"]
    assert [t["title"] for t in tasks] == ["Wireframes", "Implement API"]
    assert [t["waiting"] for t in tasks] == [False, True]
    assert (tasks[0]["milestone_title"], tasks[0]["project_name"]) == ("Design", "Apollo")
    assert dashboard["stats"]["open_tasks"] == 2
