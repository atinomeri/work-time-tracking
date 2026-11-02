"""
Minimal Employee Working Time Tracker (FastAPI + standard library sqlite3).
Stores all timestamps in UTC ISO 8601 and persists running timers in SQLite.
"""
from datetime import datetime, date, time, timedelta, timezone
import os
import sqlite3
from pathlib import Path
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

DB_PATH = os.environ.get("TIMETRACK_DB", "timetrack.db")
app = FastAPI(title="TimeTrack")


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS employees (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS time_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                employee_id INTEGER NOT NULL REFERENCES employees(id),
                task_description TEXT NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_timer
                ON time_entries(employee_id) WHERE end_time IS NULL;
            """
        )


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso_utc(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(timezone.utc)


class EmployeeIn(BaseModel):
    name: str


class TimerStartIn(BaseModel):
    employee_id: int
    task_description: str
    start_time: str | None = None


class TimerStopIn(BaseModel):
    employee_id: int
    end_time: str | None = None


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.post("/api/employees", status_code=201)
def add_employee(payload: EmployeeIn):
    name = " ".join(payload.name.strip().split())
    if not name:
        raise HTTPException(status_code=400, detail="Employee name cannot be empty.")
    created_at = utc_now_iso()
    try:
        with get_conn() as conn:
            cur = conn.execute(
                "INSERT INTO employees (name, created_at) VALUES (?, ?)",
                (name, created_at),
            )
            return {"id": cur.lastrowid, "name": name, "created_at": created_at}
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail=f"Employee '{name}' already exists.")


@app.get("/api/employees")
def list_employees():
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT e.id, e.name, e.created_at,
                   t.id AS timer_id, t.task_description, t.start_time
            FROM employees e
            LEFT JOIN time_entries t ON t.employee_id = e.id AND t.end_time IS NULL
            ORDER BY e.id ASC
            """
        ).fetchall()
        return [dict(r) for r in rows]


@app.post("/api/timers/start", status_code=201)
def start_timer(payload: TimerStartIn):
    task = payload.task_description.strip()
    if not task:
        raise HTTPException(status_code=400, detail="Task description cannot be empty.")
    start_iso = payload.start_time or utc_now_iso()
    with get_conn() as conn:
        emp = conn.execute("SELECT id, name FROM employees WHERE id = ?", (payload.employee_id,)).fetchone()
        if not emp:
            raise HTTPException(status_code=404, detail="Employee not found.")
        try:
            cur = conn.execute(
                "INSERT INTO time_entries (employee_id, task_description, start_time, end_time) VALUES (?, ?, ?, NULL)",
                (payload.employee_id, task, start_iso),
            )
            return {
                "id": cur.lastrowid,
                "employee_id": emp["id"],
                "employee_name": emp["name"],
                "task_description": task,
                "start_time": start_iso,
            }
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail="Employee already has an active timer.")


@app.post("/api/timers/stop")
def stop_timer(payload: TimerStopIn):
    stop_iso = payload.end_time or utc_now_iso()
    with get_conn() as conn:
        emp = conn.execute("SELECT id, name FROM employees WHERE id = ?", (payload.employee_id,)).fetchone()
        if not emp:
            raise HTTPException(status_code=404, detail="Employee not found.")
        active = conn.execute(
            "SELECT id, task_description, start_time FROM time_entries WHERE employee_id = ? AND end_time IS NULL",
            (payload.employee_id,),
        ).fetchone()
        if not active:
            raise HTTPException(status_code=400, detail="No active timer for this employee.")
        start_dt = parse_iso_utc(active["start_time"])
        stop_dt = parse_iso_utc(stop_iso)
        if stop_dt < start_dt:
            raise HTTPException(status_code=400, detail="Stop time cannot be earlier than start time.")
        conn.execute("UPDATE time_entries SET end_time = ? WHERE id = ?", (stop_iso, active["id"]))
        duration = int(round((stop_dt - start_dt).total_seconds()))
        return {
            "id": active["id"],
            "employee_id": emp["id"],
            "employee_name": emp["name"],
            "task_description": active["task_description"],
            "start_time": active["start_time"],
            "end_time": stop_iso,
            "duration_seconds": duration,
        }


@app.get("/api/reports")
def get_report(date_from: str = Query(...), date_to: str = Query(...)):
    try:
        d_from = date.fromisoformat(date_from)
        d_to = date.fromisoformat(date_to)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Expected YYYY-MM-DD.")
    if d_from > d_to:
        raise HTTPException(status_code=400, detail="date_from cannot be after date_to.")

    # Half-open UTC interval [period_start, period_end) for exact boundary clipping
    period_start = datetime.combine(d_from, time.min, tzinfo=timezone.utc)
    period_end = datetime.combine(d_to + timedelta(days=1), time.min, tzinfo=timezone.utc)
    p_start_iso = period_start.strftime("%Y-%m-%dT%H:%M:%SZ")
    p_end_iso = period_end.strftime("%Y-%m-%dT%H:%M:%SZ")

    with get_conn() as conn:
        employees = conn.execute("SELECT id, name FROM employees ORDER BY id ASC").fetchall()
        rows = conn.execute(
            """
            SELECT t.id, t.employee_id, e.name AS employee_name,
                   t.task_description, t.start_time, t.end_time
            FROM time_entries t
            JOIN employees e ON e.id = t.employee_id
            WHERE t.end_time IS NOT NULL
              AND t.start_time < ?
              AND t.end_time > ?
            ORDER BY t.start_time DESC
            """,
            (p_end_iso, p_start_iso),
        ).fetchall()

    totals = {emp["id"]: {"employee_id": emp["id"], "employee_name": emp["name"], "total_seconds": 0} for emp in employees}
    entries = []
    for r in rows:
        s_dt = parse_iso_utc(r["start_time"])
        e_dt = parse_iso_utc(r["end_time"])
        clip_s = max(s_dt, period_start)
        clip_e = min(e_dt, period_end)
        clipped_sec = max(0, int(round((clip_e - clip_s).total_seconds())))
        totals[r["employee_id"]]["total_seconds"] += clipped_sec
        entries.append({
            "id": r["id"],
            "employee_id": r["employee_id"],
            "employee_name": r["employee_name"],
            "task_description": r["task_description"],
            "start_time": r["start_time"],
            "end_time": r["end_time"],
            "clipped_duration_seconds": clipped_sec,
        })

    return {
        "date_from": date_from,
        "date_to": date_to,
        "employees_summary": list(totals.values()),
        "entries": entries,
    }


@app.get("/")
def index():
    return FileResponse(Path(__file__).parent / "static" / "index.html")
