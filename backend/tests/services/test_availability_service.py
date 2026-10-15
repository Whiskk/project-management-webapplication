"""Integration tests for team availability: booked hours per employee per week."""

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


def project(name: str, start: str, end: str) -> int:
    body = {
        "name": name,
        "budget": 100000,
        "manager_id": user_id("MM4R8T"),
        "start_date": start,
        "predicted_end_date": end,
    }
    status, created = call("POST", "/", "AA7K2P", body)
    assert status == 201, created
    return created["id"]


def assign(project_id: int, hours: float, as_: str = "MM4R8T") -> None:
    status, body = call(
        "POST", f"/{project_id}/assignments", as_, {"user_id": user_id("EE3H9W"), "hours_per_week": hours}
    )
    assert status == 201, body


def eli_weeks(as_: str = "MM4R8T", **query: str) -> list[dict]:
    status, body = call("GET", "/availability", as_, query={"start": "2026-11-02", "weeks": "4", **query})
    assert status == 200, body
    (eli,) = [p for p in body["people"] if p["employee_id"] == "EE3H9W"]
    return eli["weeks"]


@pytest.fixture
def booked(fresh_db: None) -> dict[str, int]:
    """
    Eli: 10 h approved on Apollo (2-13 Nov) and 15 h requested by an admin on
    Borealis (9-20 Nov), still awaiting Morgan's approval.
    """
    apollo = project("Apollo", "2026-11-02", "2026-11-13")
    borealis = project("Borealis", "2026-11-09", "2026-11-20")
    assign(apollo, 10)
    assign(borealis, 15, as_="AA7K2P")  # an admin, so it waits for Eli's manager
    return {"apollo": apollo, "borealis": borealis}


def test_weeks_split_confirmed_and_awaiting_approval(booked: dict) -> None:
    weeks = eli_weeks()
    assert [(w["booked"], w["confirmed"], w["pending"], w["free"]) for w in weeks] == [
        (10, 10, 0, 30),  # 2-6 Nov: Apollo
        (25, 10, 15, 15),  # 9-13 Nov: Apollo + Borealis (pending)
        (15, 0, 15, 25),  # 16-20 Nov: Borealis (pending)
        (0, 0, 0, 40),
    ]


def test_window_snaps_to_monday_and_lists_weeks(booked: dict) -> None:
    status, body = call("GET", "/availability", "AA7K2P", query={"start": "2026-11-04", "weeks": "2"})
    assert status == 200
    assert body["weeks"] == [{"start": "2026-11-02", "end": "2026-11-06"}, {"start": "2026-11-09", "end": "2026-11-13"}]
    assert body["capacity"] == 40


def test_projects_in_the_same_week_that_do_not_overlap_are_not_added(fresh_db: None) -> None:
    # Mon-Tue and Wed-Fri of the same week: the busiest day has 30 h, not 60.
    assign(project("Early", "2026-11-02", "2026-11-03"), 30)
    assign(project("Late", "2026-11-04", "2026-11-06"), 30)
    assert eli_weeks()[0]["booked"] == 30


def test_archived_projects_free_the_time(booked: dict) -> None:
    assert call("POST", f"/{booked['apollo']}/archive", "AA7K2P")[0] == 200
    assert eli_weeks()[0]["booked"] == 0


def test_flags_the_managers_own_reports_and_reveals_no_project_names(booked: dict) -> None:
    _, body = call("GET", "/availability", "MM4R8T", query={"start": "2026-11-02"})
    eli = next(p for p in body["people"] if p["employee_id"] == "EE3H9W")
    assert eli["is_my_report"] is True
    assert eli["manager_name"] == "Morgan Manager"
    assert len(body["weeks"]) == 12
    assert "Apollo" not in str(body) and "Borealis" not in str(body)
    _, body = call("GET", "/availability", "AA7K2P", query={"start": "2026-11-02"})
    assert next(p for p in body["people"] if p["employee_id"] == "EE3H9W")["is_my_report"] is False


def test_only_active_employees_are_listed(booked: dict) -> None:
    _, body = call("GET", "/availability", "AA7K2P")
    assert {p["employee_id"] for p in body["people"]} == {"EE3H9W"}


def test_employees_cannot_see_availability(fresh_db: None) -> None:
    assert call("GET", "/availability", "EE3H9W")[0] == 403


@pytest.mark.parametrize(
    ("query", "field"),
    [({"weeks": "0"}, "weeks"), ({"weeks": "27"}, "weeks"), ({"weeks": "x"}, "weeks"), ({"start": "soon"}, "start")],
)
def test_invalid_window_is_rejected(fresh_db: None, query: dict, field: str) -> None:
    status, body = call("GET", "/availability", "MM4R8T", query=query)
    assert (status, list(body["error"]["details"])) == (400, [field])
