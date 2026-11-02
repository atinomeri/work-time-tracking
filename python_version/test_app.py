"""
Independent automated tests for the Employee Working Time Tracker using a temporary SQLite database.
Covers: adding employees, start/stop timer, state survival across restart, period clipping, and empty report.
"""
import pytest
from fastapi.testclient import TestClient
import python_version.app as tracker_app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db_file = tmp_path / "test_timetrack.db"
    monkeypatch.setattr(tracker_app, "DB_PATH", str(db_file))
    tracker_app.init_db()
    with TestClient(tracker_app.app) as c:
        yield c


def test_add_employee_and_validation(client):
    res = client.post("/api/employees", json={"name": "  Anna Test  "})
    assert res.status_code == 201
    assert res.json()["name"] == "Anna Test"

    # Empty name rejected
    assert client.post("/api/employees", json={"name": "   "}).status_code == 400
    # Duplicate name rejected (case-insensitive)
    assert client.post("/api/employees", json={"name": "anna test"}).status_code == 409


def test_start_and_stop_timer_constraints(client):
    emp_id = client.post("/api/employees", json={"name": "Anna Test"}).json()["id"]

    # Empty task rejected
    assert client.post("/api/timers/start", json={"employee_id": emp_id, "task_description": "  "}).status_code == 400

    # Valid start
    r1 = client.post(
        "/api/timers/start",
        json={"employee_id": emp_id, "task_description": "Write tests", "start_time": "2026-03-10T10:00:00Z"},
    )
    assert r1.status_code == 201

    # Second simultaneous timer rejected
    r2 = client.post(
        "/api/timers/start",
        json={"employee_id": emp_id, "task_description": "Second task", "start_time": "2026-03-10T10:05:00Z"},
    )
    assert r2.status_code == 409

    # Stop timer
    stop_res = client.post(
        "/api/timers/stop",
        json={"employee_id": emp_id, "end_time": "2026-03-10T11:30:00Z"},
    )
    assert stop_res.status_code == 200
    assert stop_res.json()["duration_seconds"] == 5400

    # Stopping non-running timer rejected
    assert client.post("/api/timers/stop", json={"employee_id": emp_id}).status_code == 400


def test_timer_survives_application_restart(tmp_path, monkeypatch):
    db_file = tmp_path / "restart_check.db"
    monkeypatch.setattr(tracker_app, "DB_PATH", str(db_file))
    tracker_app.init_db()

    with TestClient(tracker_app.app) as client_before:
        emp_id = client_before.post("/api/employees", json={"name": "Ivan Sample"}).json()["id"]
        client_before.post(
            "/api/timers/start",
            json={"employee_id": emp_id, "task_description": "Long job", "start_time": "2026-03-15T08:00:00Z"},
        )

    # Simulate application restart with a new client instance attached to the same SQLite file
    with TestClient(tracker_app.app) as client_after:
        employees = client_after.get("/api/employees").json()
        assert employees[0]["timer_id"] is not None
        assert employees[0]["start_time"] == "2026-03-15T08:00:00Z"

        stopped = client_after.post(
            "/api/timers/stop",
            json={"employee_id": emp_id, "end_time": "2026-03-15T09:00:00Z"},
        )
        assert stopped.status_code == 200
        assert stopped.json()["duration_seconds"] == 3600


def test_period_total_and_boundary_clipping(client):
    emp_id = client.post("/api/employees", json={"name": "Anna Test"}).json()["id"]

    # Crosses midnight into 2026-04-02 (23:00 -> 01:00 UTC = 1 hour inside 2026-04-02)
    client.post(
        "/api/timers/start",
        json={"employee_id": emp_id, "task_description": "Night shift", "start_time": "2026-04-01T23:00:00Z"},
    )
    client.post("/api/timers/stop", json={"employee_id": emp_id, "end_time": "2026-04-02T01:00:00Z"})

    # Daytime shift on 2026-04-02 (10:00 -> 12:00 UTC = 2 hours)
    client.post(
        "/api/timers/start",
        json={"employee_id": emp_id, "task_description": "Day shift", "start_time": "2026-04-02T10:00:00Z"},
    )
    client.post("/api/timers/stop", json={"employee_id": emp_id, "end_time": "2026-04-02T12:00:00Z"})

    rep = client.get("/api/reports?date_from=2026-04-02&date_to=2026-04-02").json()
    assert rep["employees_summary"][0]["total_seconds"] == 10800


def test_empty_report_and_invalid_period(client):
    client.post("/api/employees", json={"name": "Anna Test"})
    empty = client.get("/api/reports?date_from=2025-01-01&date_to=2025-01-10").json()
    assert empty["entries"] == []
    assert empty["employees_summary"][0]["total_seconds"] == 0

    # date_from > date_to must fail with 400
    bad = client.get("/api/reports?date_from=2026-05-10&date_to=2026-05-01")
    assert bad.status_code == 400
