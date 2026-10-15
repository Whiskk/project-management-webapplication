"""The employee's "What's new" feed: recent changes about them, in their words."""

import pytest

from conftest import bearer, demo_user, load_service, make_event, response_json
from pm_core import db

projects_service = load_service("projects")
auth_service = load_service("auth")

import whats_new  # noqa: E402 - importable once the projects service is on the path

ELI = "EE3H9W"


def call(method: str, path: str, as_: str, body: object = None) -> tuple[int, dict]:
    response = projects_service.handler(make_event(method, f"/api/projects{path}", body=body, headers=bearer(as_)))
    return response["statusCode"], response_json(response)


def ok(method: str, path: str, as_: str, body: object = None) -> dict:
    status, result = call(method, path, as_, body)
    assert status < 300, result
    return result


def user_id(employee_id: str) -> int:
    with db.transaction() as cur:
        cur.execute("SELECT id FROM users WHERE employee_id = %s", (employee_id,))
        return cur.fetchone()["id"]


def sign_in_eli() -> None:
    body = {"employee_id": ELI, "password": demo_user(ELI)["local_password"]}
    response = auth_service.handler(make_event("POST", "/api/auth/login", body=body))
    assert response["statusCode"] == 200


def feed() -> dict:
    return ok("GET", "/dashboard", ELI)["whats_new"]


def texts() -> list[str]:
    return [item["text"] for item in feed()["items"]]


@pytest.fixture
def apollo(fresh_db: None) -> int:
    sign_in_eli()
    body = {
        "name": "Apollo",
        "budget": 100000,
        "manager_id": user_id("MM4R8T"),
        "start_date": "2026-11-02",
        "predicted_end_date": "2026-11-13",
    }
    return ok("POST", "/", "AA7K2P", body)["id"]


@pytest.mark.db
def test_tells_the_employee_what_changed_for_them_newest_first(apollo: int) -> None:
    assignment = ok("POST", f"/{apollo}/assignments", "MM4R8T", {"user_id": user_id(ELI), "hours_per_week": 10})["id"]
    ok("PATCH", f"/{apollo}/assignments/{assignment}", "MM4R8T", {"hours_per_week": 12})
    ok("PATCH", f"/{apollo}/assignments/{assignment}", "AA7K2P", {"hours_per_week": 20})  # needs Morgan's approval
    ok("POST", f"/{apollo}/assignments/{assignment}/reject", "MM4R8T", {})
    design = ok(
        "POST",
        f"/{apollo}/milestones",
        "MM4R8T",
        {"title": "Design", "start_date": "2026-11-02", "due_date": "2026-11-06"},
    )["id"]
    task = ok(
        "POST", f"/{apollo}/milestones/{design}/tasks", "MM4R8T", {"title": "Wireframes", "assignee_id": user_id(ELI)}
    )
    ok("POST", f"/{apollo}/tasks/{task['id']}/complete", "MM4R8T")
    ok("PATCH", f"/{apollo}", "AA7K2P", {"budget": 90000})  # nothing for an employee
    ok("PATCH", f"/{apollo}", "AA7K2P", {"predicted_end_date": "2026-11-20"})

    assert texts() == [
        "Apollo now ends Nov 20, 2026 (was Nov 13, 2026)",
        "Morgan Manager ticked off your task 'Wireframes' on Apollo",
        "Morgan Manager gave you a new task on Apollo: 'Wireframes'",
        "New milestone on Apollo: 'Design', due Nov 6, 2026",
        "The requested increase to your hours on Apollo was declined; you stay at 12 h/week",
        "Alex Admin asked to raise your hours on Apollo to 20 h/week. It's waiting for your manager's approval.",
        "Morgan Manager changed your hours on Apollo from 10 h/week to 12 h/week",
        "Morgan Manager added you to Apollo for 10 h/week",
    ]


@pytest.mark.db
def test_leaves_out_the_employees_own_actions_and_other_peoples_changes(apollo: int) -> None:
    ok("POST", f"/{apollo}/assignments", "MM4R8T", {"user_id": user_id(ELI), "hours_per_week": 10})
    design = ok(
        "POST",
        f"/{apollo}/milestones",
        "MM4R8T",
        {"title": "Design", "start_date": "2026-11-02", "due_date": "2026-11-06"},
    )["id"]
    task = ok(
        "POST", f"/{apollo}/milestones/{design}/tasks", "MM4R8T", {"title": "Wireframes", "assignee_id": user_id(ELI)}
    )
    ok("POST", f"/{apollo}/tasks/{task['id']}/complete", ELI)  # Eli's own tick
    # Another project Eli is not on.
    other = ok(
        "POST",
        "/",
        "AA7K2P",
        {
            "name": "Borealis",
            "budget": 1000,
            "manager_id": user_id("MM4R8T"),
            "start_date": "2026-11-02",
            "predicted_end_date": "2026-11-13",
        },
    )["id"]
    ok("PATCH", f"/{other}", "AA7K2P", {"predicted_end_date": "2026-11-20"})

    items = texts()
    assert not any("ticked off" in text or "Borealis" in text for text in items)
    assert not any("$" in text or "budget" in text.lower() for text in items)


@pytest.mark.db
def test_marks_changes_since_the_previous_sign_in_as_new(apollo: int) -> None:
    ok("POST", f"/{apollo}/assignments", "MM4R8T", {"user_id": user_id(ELI), "hours_per_week": 10})
    sign_in_eli()  # the change happened after the previous sign-in
    result = feed()
    assert result["since"] is not None
    assert (result["new_count"], result["items"][0]["is_new"]) == (1, True)
    assert result["items"][0]["project_id"] == apollo

    sign_in_eli()  # signed in again since: no longer new
    result = feed()
    assert (result["new_count"], result["items"][0]["is_new"]) == (0, False)


@pytest.mark.db
def test_only_employees_get_the_feed(apollo: int) -> None:
    assert "whats_new" not in ok("GET", "/dashboard", "MM4R8T")


# ------------------------------------------------------------------ wording (no database)


def row(action: str, changes: dict, title: str | None = None) -> dict:
    return {
        "action": action,
        "actor_name": "Morgan Manager",
        "project_name": "Apollo",
        "current_title": title,
        "changes": {field: {"from": old, "to": new} for field, (old, new) in changes.items()},
    }


@pytest.mark.parametrize(
    ("entry", "text"),
    [
        (
            row("assignment.request", {"user": (None, ELI), "hours_per_week": (None, 8)}),
            "Morgan Manager asked for 8 h/week of your time on Apollo. It's waiting for your manager's approval.",
        ),
        (
            row("assignment.request", {"hours_per_week": (8, 6)}),
            "Morgan Manager changed the hours requested for you on Apollo to 6 h/week",
        ),
        (
            row("assignment.update", {"status": ("pending", "approved"), "hours_per_week": (8, 8)}),
            "Morgan Manager added you to Apollo for 8 h/week",
        ),
        (
            row("assignment.update", {"pending_hours": (20, None)}),
            "The requested increase to your hours on Apollo was cancelled",
        ),
        (
            row("assignment.approve", {"status": ("pending", "approved"), "hours_per_week": (None, 7.5)}),
            "Morgan Manager approved your 7.5 h/week on Apollo",
        ),
        (
            row("assignment.reject", {"status": ("pending", None), "hours_per_week": (8, None)}),
            "The request for 8 h/week of your time on Apollo was declined",
        ),
        (row("assignment.delete", {"user": (ELI, None)}), "Morgan Manager removed you from Apollo"),
        (
            row("task.update", {"assignee": (None, ELI)}, title="Wireframes"),
            "Morgan Manager gave you the task 'Wireframes' on Apollo",
        ),
        (
            row("task.update", {"assignee": (ELI, None)}, title="Wireframes"),
            "Morgan Manager took you off the task 'Wireframes' on Apollo",
        ),
        (
            row("task.update", {"title": ("Wires", "Wireframes")}, title="Wireframes"),
            "Morgan Manager updated your task 'Wireframes' on Apollo",
        ),
        (
            row("task.reopen", {"done": (True, False)}, title="Wireframes"),
            "Morgan Manager reopened your task 'Wireframes' on Apollo",
        ),
        (
            row("task.delete", {"title": ("Wireframes", None)}),
            "Morgan Manager deleted your task 'Wireframes' from Apollo",
        ),
        (row("project.archive", {}), "Apollo was archived"),
        (row("project.reactivate", {}), "Apollo was reactivated"),
        (
            row("project.update", {"name": ("Apolo", "Apollo"), "start_date": ("2026-11-02", "2026-11-09")}),
            "Apollo was renamed from Apolo, now starts Nov 9, 2026",
        ),
        (row("project.update", {"status": ("planned", "on_hold")}), "Apollo is now on hold"),
        (row("project.update", {"budget": (1, 2), "description": ("a", "b")}), None),
        (
            row("milestone.update", {"status": ("in_progress", "completed")}, title="Design"),
            "The milestone 'Design' on Apollo was completed",
        ),
        (
            row(
                "milestone.update",
                {"due_date": ("2026-11-06", "2026-11-10"), "status": ("not_started", "in_progress")},
                "Design",
            ),
            "The milestone 'Design' on Apollo is now due Nov 10, 2026 (was Nov 6, 2026) and is now in progress",
        ),
        (row("milestone.update", {"description": ("a", "b")}, title="Design"), None),
        (row("milestone.delete", {"title": ("Design", None)}), "The milestone 'Design' was removed from Apollo"),
    ],
)
def test_describe(entry: dict, text: str | None) -> None:
    assert whats_new.describe(entry, ELI) == text
