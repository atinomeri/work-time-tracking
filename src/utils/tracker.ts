import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export class TrackerError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'TrackerError';
    this.statusCode = statusCode;
  }
}

export interface Employee {
  id: number;
  name: string;
  created_at: string;
  active_timer: ActiveTimerEntry | null;
}

export interface ActiveTimerEntry {
  id: number;
  employee_id: number;
  employee_name: string;
  task_description: string;
  start_time: string;
  elapsed_seconds: number;
}

export interface TimeEntryRecord {
  id: number;
  employee_id: number;
  employee_name: string;
  task_description: string;
  start_time: string;
  end_time: string | null;
  raw_duration_seconds: number;
  clipped_duration_seconds: number;
  is_clipped: boolean;
}

export interface EmployeeSummary {
  employee_id: number;
  employee_name: string;
  total_seconds: number;
  entries_count: number;
  has_active_timer: boolean;
}

export interface PeriodReport {
  date_from: string;
  date_to: string;
  period_start_utc: string;
  period_end_utc: string;
  boundary_policy: 'clip_to_period';
  total_period_seconds: number;
  employees_summary: EmployeeSummary[];
  entries: TimeEntryRecord[];
}

export interface TestCaseResult {
  id: string;
  name: string;
  description: string;
  passed: boolean;
  duration_ms: number;
  error?: string;
}

/**
 * Validates a YYYY-MM-DD date string and returns UTC millisecond bounds for the day.
 */
export function parseStrictUtcDate(dateStr: string, fieldName: string): {
  startIso: string;
  endIso: string;
  startMs: number;
  endMs: number;
} {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) {
    throw new TrackerError(
      `Поле "${fieldName}" должно быть в формате ГГГГ-ММ-ДД (получено: "${dateStr || ''}").`,
      400
    );
  }
  const clean = dateStr.trim();
  const [y, m, d] = clean.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() + 1 !== m ||
    dt.getUTCDate() !== d
  ) {
    throw new TrackerError(`Некорректная календарная дата в поле "${fieldName}": ${clean}.`, 400);
  }
  const startIso = `${clean}T00:00:00.000Z`;
  const endIso = `${clean}T23:59:59.999Z`;
  return {
    startIso,
    endIso,
    startMs: Date.parse(startIso),
    endMs: Date.parse(endIso),
  };
}

/**
 * Clips an entry's [start_time, end_time] interval to [periodStartMs, periodEndMs].
 * Returns both raw duration and clipped duration in whole seconds.
 */
export function computeClippedDuration(
  startIso: string,
  endIso: string,
  periodStartMs: number,
  periodEndMs: number
): { rawSeconds: number; clippedSeconds: number; isClipped: boolean } {
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  const rawSeconds = Math.max(0, Math.round((endMs - startMs) / 1000));

  const clippedStartMs = Math.max(startMs, periodStartMs);
  const clippedEndMs = Math.min(endMs, periodEndMs);
  const clippedSeconds = Math.max(0, Math.round((clippedEndMs - clippedStartMs) / 1000));
  const isClipped = startMs < periodStartMs || endMs > periodEndMs;

  return { rawSeconds, clippedSeconds, isClipped };
}

export class TimeTrackerStore {
  private db: DatabaseSync;
  public readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    const dir = path.dirname(dbPath);
    if (dir && dir !== '.' && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS time_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        task_description TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NULL,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      );

      -- Enforces at the database level that an employee can have at most one running timer (end_time IS NULL)
      CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_timer_per_employee
        ON time_entries(employee_id)
        WHERE end_time IS NULL;
    `);
  }

  public close(): void {
    this.db.close();
  }

  public addEmployee(rawName: unknown, nowIso = new Date().toISOString()): Employee {
    if (typeof rawName !== 'string') {
      throw new TrackerError('Имя сотрудника должно быть строкой.', 400);
    }
    const name = rawName.trim().replace(/\s+/g, ' ');
    if (!name) {
      throw new TrackerError('Имя сотрудника не может быть пустым.', 400);
    }
    if (name.length > 80) {
      throw new TrackerError('Имя сотрудника слишком длинное (максимум 80 символов).', 400);
    }

    const existing = this.db
      .prepare('SELECT id FROM employees WHERE lower(name) = lower(?)')
      .get(name) as { id: number } | undefined;

    if (existing) {
      throw new TrackerError(`Сотрудник с именем «${name}» уже существует.`, 409);
    }

    const result = this.db
      .prepare('INSERT INTO employees (name, created_at) VALUES (?, ?)')
      .run(name, nowIso);

    return {
      id: Number(result.lastInsertRowid),
      name,
      created_at: nowIso,
      active_timer: null,
    };
  }

  public listEmployees(nowIso = new Date().toISOString()): Employee[] {
    const nowMs = Date.parse(nowIso);
    const rows = this.db
      .prepare(`
        SELECT
          e.id,
          e.name,
          e.created_at,
          t.id AS timer_id,
          t.task_description,
          t.start_time
        FROM employees e
        LEFT JOIN time_entries t
          ON t.employee_id = e.id AND t.end_time IS NULL
        ORDER BY e.id ASC
      `)
      .all() as Array<{
      id: number;
      name: string;
      created_at: string;
      timer_id: number | null;
      task_description: string | null;
      start_time: string | null;
    }>;

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      created_at: r.created_at,
      active_timer:
        r.timer_id !== null && r.start_time !== null && r.task_description !== null
          ? {
              id: r.timer_id,
              employee_id: r.id,
              employee_name: r.name,
              task_description: r.task_description,
              start_time: r.start_time,
              elapsed_seconds: Math.max(0, Math.round((nowMs - Date.parse(r.start_time)) / 1000)),
            }
          : null,
    }));
  }

  public getActiveTimers(nowIso = new Date().toISOString()): ActiveTimerEntry[] {
    const nowMs = Date.parse(nowIso);
    const rows = this.db
      .prepare(`
        SELECT
          t.id,
          t.employee_id,
          e.name AS employee_name,
          t.task_description,
          t.start_time
        FROM time_entries t
        JOIN employees e ON e.id = t.employee_id
        WHERE t.end_time IS NULL
        ORDER BY t.start_time ASC
      `)
      .all() as Array<{
      id: number;
      employee_id: number;
      employee_name: string;
      task_description: string;
      start_time: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      employee_id: r.employee_id,
      employee_name: r.employee_name,
      task_description: r.task_description,
      start_time: r.start_time,
      elapsed_seconds: Math.max(0, Math.round((nowMs - Date.parse(r.start_time)) / 1000)),
    }));
  }

  public startTimer(
    employeeIdRaw: unknown,
    taskDescriptionRaw: unknown,
    nowIso = new Date().toISOString()
  ): ActiveTimerEntry {
    const employeeId = Number(employeeIdRaw);
    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      throw new TrackerError('Некорректный идентификатор сотрудника.', 400);
    }

    if (typeof taskDescriptionRaw !== 'string') {
      throw new TrackerError('Описание задачи обязательно для запуска таймера.', 400);
    }
    const taskDescription = taskDescriptionRaw.trim();
    if (!taskDescription) {
      throw new TrackerError('Описание задачи не может быть пустым.', 400);
    }
    if (taskDescription.length > 250) {
      throw new TrackerError('Описание задачи слишком длинное (максимум 250 символов).', 400);
    }

    const employee = this.db
      .prepare('SELECT id, name FROM employees WHERE id = ?')
      .get(employeeId) as { id: number; name: string } | undefined;

    if (!employee) {
      throw new TrackerError(`Сотрудник с ID ${employeeId} не найден.`, 404);
    }

    const activeTimer = this.db
      .prepare('SELECT id, task_description, start_time FROM time_entries WHERE employee_id = ? AND end_time IS NULL')
      .get(employeeId) as { id: number; task_description: string; start_time: string } | undefined;

    if (activeTimer) {
      throw new TrackerError(
        `У сотрудника «${employee.name}» уже запущен таймер по задаче «${activeTimer.task_description}». Сначала остановите его.`,
        409
      );
    }

    const result = this.db
      .prepare(
        'INSERT INTO time_entries (employee_id, task_description, start_time, end_time) VALUES (?, ?, ?, NULL)'
      )
      .run(employeeId, taskDescription, nowIso);

    return {
      id: Number(result.lastInsertRowid),
      employee_id: employee.id,
      employee_name: employee.name,
      task_description: taskDescription,
      start_time: nowIso,
      elapsed_seconds: 0,
    };
  }

  public stopTimer(
    employeeIdRaw: unknown,
    nowIso = new Date().toISOString()
  ): TimeEntryRecord {
    const employeeId = Number(employeeIdRaw);
    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      throw new TrackerError('Некорректный идентификатор сотрудника.', 400);
    }

    const employee = this.db
      .prepare('SELECT id, name FROM employees WHERE id = ?')
      .get(employeeId) as { id: number; name: string } | undefined;

    if (!employee) {
      throw new TrackerError(`Сотрудник с ID ${employeeId} не найден.`, 404);
    }

    const activeTimer = this.db
      .prepare(
        'SELECT id, task_description, start_time FROM time_entries WHERE employee_id = ? AND end_time IS NULL'
      )
      .get(employeeId) as { id: number; task_description: string; start_time: string } | undefined;

    if (!activeTimer) {
      throw new TrackerError(
        `У сотрудника «${employee.name}» нет активного таймера для остановки.`,
        400
      );
    }

    const startMs = Date.parse(activeTimer.start_time);
    const stopMs = Date.parse(nowIso);
    if (stopMs < startMs) {
      throw new TrackerError(
        'Время остановки не может быть раньше времени старта таймера.',
        400
      );
    }

    this.db
      .prepare('UPDATE time_entries SET end_time = ? WHERE id = ?')
      .run(nowIso, activeTimer.id);

    const rawSeconds = Math.max(0, Math.round((stopMs - startMs) / 1000));

    return {
      id: activeTimer.id,
      employee_id: employee.id,
      employee_name: employee.name,
      task_description: activeTimer.task_description,
      start_time: activeTimer.start_time,
      end_time: nowIso,
      raw_duration_seconds: rawSeconds,
      clipped_duration_seconds: rawSeconds,
      is_clipped: false,
    };
  }

  public getPeriodReport(dateFromRaw: string, dateToRaw: string): PeriodReport {
    const fromParsed = parseStrictUtcDate(dateFromRaw, 'date_from');
    const toParsed = parseStrictUtcDate(dateToRaw, 'date_to');

    if (fromParsed.startMs > toParsed.startMs) {
      throw new TrackerError(
        `Начальная дата (${dateFromRaw}) не может быть позже конечной даты (${dateToRaw}).`,
        400
      );
    }

    const employees = this.listEmployees();

    // Select completed entries that overlap [periodStart, periodEnd] in UTC
    const rows = this.db
      .prepare(`
        SELECT
          t.id,
          t.employee_id,
          e.name AS employee_name,
          t.task_description,
          t.start_time,
          t.end_time
        FROM time_entries t
        JOIN employees e ON e.id = t.employee_id
        WHERE t.end_time IS NOT NULL
          AND t.start_time <= ?
          AND t.end_time >= ?
        ORDER BY t.start_time DESC, t.id DESC
      `)
      .all(toParsed.endIso, fromParsed.startIso) as Array<{
      id: number;
      employee_id: number;
      employee_name: string;
      task_description: string;
      start_time: string;
      end_time: string;
    }>;

    const summaryMap = new Map<number, EmployeeSummary>();
    for (const emp of employees) {
      summaryMap.set(emp.id, {
        employee_id: emp.id,
        employee_name: emp.name,
        total_seconds: 0,
        entries_count: 0,
        has_active_timer: emp.active_timer !== null,
      });
    }

    const entries: TimeEntryRecord[] = [];
    let totalPeriodSeconds = 0;

    for (const r of rows) {
      const { rawSeconds, clippedSeconds, isClipped } = computeClippedDuration(
        r.start_time,
        r.end_time,
        fromParsed.startMs,
        toParsed.endMs
      );

      // Include entries that overlap the selected window
      entries.push({
        id: r.id,
        employee_id: r.employee_id,
        employee_name: r.employee_name,
        task_description: r.task_description,
        start_time: r.start_time,
        end_time: r.end_time,
        raw_duration_seconds: rawSeconds,
        clipped_duration_seconds: clippedSeconds,
        is_clipped: isClipped,
      });

      const empSummary = summaryMap.get(r.employee_id);
      if (empSummary) {
        empSummary.total_seconds += clippedSeconds;
        empSummary.entries_count += 1;
      }
      totalPeriodSeconds += clippedSeconds;
    }

    return {
      date_from: dateFromRaw.trim(),
      date_to: dateToRaw.trim(),
      period_start_utc: fromParsed.startIso,
      period_end_utc: toParsed.endIso,
      boundary_policy: 'clip_to_period',
      total_period_seconds: totalPeriodSeconds,
      employees_summary: Array.from(summaryMap.values()),
      entries,
    };
  }

  /**
   * Seeds fictional employees ("Anna Test", "Ivan Sample", "Maria Example")
   * and sample records if the database is completely empty.
   */
  public seedDemoDataIfEmpty(): void {
    const countRow = this.db.prepare('SELECT COUNT(*) AS cnt FROM employees').get() as {
      cnt: number;
    };
    if (countRow.cnt > 0) {
      return;
    }

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    const anna = this.addEmployee('Anna Test', `${yesterdayStr}T08:00:00.000Z`);
    const ivan = this.addEmployee('Ivan Sample', `${yesterdayStr}T08:05:00.000Z`);
    const maria = this.addEmployee('Maria Example', `${yesterdayStr}T08:10:00.000Z`);

    // 1. Completed session for Anna Test today (2 hours 15 mins = 8100s)
    this.startTimer(
      anna.id,
      'Проектирование схемы SQLite и индексов активных таймеров',
      `${todayStr}T08:00:00.000Z`
    );
    this.stopTimer(anna.id, `${todayStr}T10:15:00.000Z`);

    // 2. Boundary-crossing night shift for Ivan Sample: started yesterday 23:00 UTC, ended today 01:30 UTC
    // Total raw = 2h 30m (9000s); clipped to today = 1h 30m (5400s)
    this.startTimer(
      ivan.id,
      'Ночное обновление миграций и проверка граничных дат (переход через 00:00 UTC)',
      `${yesterdayStr}T23:00:00.000Z`
    );
    this.stopTimer(ivan.id, `${todayStr}T01:30:00.000Z`);

    // 3. Regular completed session for Ivan Sample today (1 hour 20 mins = 4800s)
    this.startTimer(
      ivan.id,
      'Написание pytest / node:test проверок для пустого отчёта',
      `${todayStr}T09:00:00.000Z`
    );
    this.stopTimer(ivan.id, `${todayStr}T10:20:00.000Z`);

    // 4. Completed session for Maria Example yesterday (3 hours = 10800s)
    this.startTimer(
      maria.id,
      'Ревью кода и документирование алгоритма усечения периода в README',
      `${yesterdayStr}T13:00:00.000Z`
    );
    this.stopTimer(maria.id, `${yesterdayStr}T16:00:00.000Z`);

    // 5. Currently active timer for Anna Test (started 25 minutes ago, stored in DB)
    const activeStart = new Date(now.getTime() - 25 * 60 * 1000).toISOString();
    this.startTimer(
      anna.id,
      'Интеграционное тестирование сохранения таймера при перезапуске',
      activeStart
    );
  }
}

/**
 * Executes the automated test suite against an isolated temporary SQLite database.
 */
export function runIsolatedTestSuite(): TestCaseResult[] {
  const results: TestCaseResult[] = [];

  const runCase = (id: string, name: string, description: string, fn: (dbPath: string) => void) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timetrack-test-'));
    const dbPath = path.join(tmpDir, 'test.db');
    const started = performance.now();
    try {
      fn(dbPath);
      results.push({
        id,
        name,
        description,
        passed: true,
        duration_ms: Math.max(1, Math.round(performance.now() - started)),
      });
    } catch (err: unknown) {
      results.push({
        id,
        name,
        description,
        passed: false,
        duration_ms: Math.max(1, Math.round(performance.now() - started)),
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  };

  // Test 1: Adding employee + duplicate/empty validation
  runCase(
    'test_add_employee',
    '1. Добавление сотрудников и валидация дубликатов',
    'Проверяет создание "Anna Test", отклонение пустого имени (400) и запрет дубликата (409).',
    (dbPath) => {
      const store = new TimeTrackerStore(dbPath);
      try {
        const emp = store.addEmployee('  Anna Test  ');
        if (emp.name !== 'Anna Test') throw new Error('Expected trimmed name Anna Test');

        let emptyRejected = false;
        try {
          store.addEmployee('   ');
        } catch (e) {
          if (e instanceof TrackerError && e.statusCode === 400) emptyRejected = true;
        }
        if (!emptyRejected) throw new Error('Empty name was not rejected with 400');

        let dupRejected = false;
        try {
          store.addEmployee('anna test');
        } catch (e) {
          if (e instanceof TrackerError && e.statusCode === 409) dupRejected = true;
        }
        if (!dupRejected) throw new Error('Duplicate employee name was not rejected with 409');
      } finally {
        store.close();
      }
    }
  );

  // Test 2: Start and stop timer + one active timer rule
  runCase(
    'test_start_stop_timer',
    '2. Запуск и остановка таймера (защита от повторного старта)',
    'Проверяет старт с задачей, блокировку второго активного таймера (409) и блокировку повторной остановки (400).',
    (dbPath) => {
      const store = new TimeTrackerStore(dbPath);
      try {
        const anna = store.addEmployee('Anna Test');
        store.startTimer(anna.id, 'Разработка REST API', '2026-03-10T10:00:00.000Z');

        let secondStartBlocked = false;
        try {
          store.startTimer(anna.id, 'Вторая параллельная задача', '2026-03-10T10:05:00.000Z');
        } catch (e) {
          if (e instanceof TrackerError && e.statusCode === 409) secondStartBlocked = true;
        }
        if (!secondStartBlocked) throw new Error('Second active timer was not blocked');

        const stopped = store.stopTimer(anna.id, '2026-03-10T11:30:00.000Z');
        if (stopped.raw_duration_seconds !== 5400) {
          throw new Error(`Expected 5400s, got ${stopped.raw_duration_seconds}`);
        }

        let secondStopBlocked = false;
        try {
          store.stopTimer(anna.id, '2026-03-10T11:35:00.000Z');
        } catch (e) {
          if (e instanceof TrackerError && e.statusCode === 400) secondStopBlocked = true;
        }
        if (!secondStopBlocked) throw new Error('Stopping non-running timer was not blocked');
      } finally {
        store.close();
      }
    }
  );

  // Test 3: Timer survival across application restart
  runCase(
    'test_restart_persistence',
    '3. Сохранение активного таймера после перезапуска приложения',
    'Запускает таймер, закрывает БД и создаёт новый экземпляр TimeTrackerStore на том же файле.',
    (dbPath) => {
      const store1 = new TimeTrackerStore(dbPath);
      const ivan = store1.addEmployee('Ivan Sample');
      store1.startTimer(ivan.id, 'Долгая фоновая задача', '2026-03-15T08:00:00.000Z');
      store1.close();

      // Simulate full process restart by opening a fresh store instance on the same file
      const store2 = new TimeTrackerStore(dbPath);
      try {
        const active = store2.getActiveTimers('2026-03-15T09:00:00.000Z');
        if (active.length !== 1) throw new Error('Active timer lost after restart');
        if (active[0].employee_name !== 'Ivan Sample') throw new Error('Employee mismatch');
        if (active[0].elapsed_seconds !== 3600) {
          throw new Error(`Expected 3600s elapsed, got ${active[0].elapsed_seconds}`);
        }

        const completed = store2.stopTimer(ivan.id, '2026-03-15T09:15:00.000Z');
        if (completed.raw_duration_seconds !== 4500) {
          throw new Error(`Expected 4500s after stop, got ${completed.raw_duration_seconds}`);
        }
      } finally {
        store2.close();
      }
    }
  );

  // Test 4: Period calculation & boundary clipping
  runCase(
    'test_period_clipping',
    '4. Расчёт времени за период и усечение на границах (Clipping)',
    'Проверяет суммирование задач и точное усечение смены (23:00 -> 01:00 UTC) по границе выбранного дня.',
    (dbPath) => {
      const store = new TimeTrackerStore(dbPath);
      try {
        const anna = store.addEmployee('Anna Test');
        // Shift crossing midnight: 2026-04-01 23:00 UTC -> 2026-04-02 01:00 UTC (2h raw, 1h on Apr 2)
        store.startTimer(anna.id, 'Ночной релиз', '2026-04-01T23:00:00.000Z');
        store.stopTimer(anna.id, '2026-04-02T01:00:00.000Z');

        // Daytime task on Apr 2: 10:00 -> 12:00 UTC (2h = 7200s)
        store.startTimer(anna.id, 'Утренний стендап и код-ревью', '2026-04-02T10:00:00.000Z');
        store.stopTimer(anna.id, '2026-04-02T12:00:00.000Z');

        const reportApr2 = store.getPeriodReport('2026-04-02', '2026-04-02');
        const annaSummary = reportApr2.employees_summary.find((s) => s.employee_id === anna.id);
        if (!annaSummary) throw new Error('Anna summary missing');
        // 3600s (clipped from night shift) + 7200s (daytime task) = 10800s (3 hours)
        if (annaSummary.total_seconds !== 10800) {
          throw new Error(`Expected 10800s clipped total, got ${annaSummary.total_seconds}`);
        }
      } finally {
        store.close();
      }
    }
  );

  // Test 5: Empty report & invalid period validation
  runCase(
    'test_empty_report_and_dates',
    '5. Пустой отчёт за период и валидация дат (date_from > date_to)',
    'Проверяет нулевые суммы при отсутствии записей за период и ошибку 400 при инвертированных датах.',
    (dbPath) => {
      const store = new TimeTrackerStore(dbPath);
      try {
        store.addEmployee('Anna Test');
        store.addEmployee('Ivan Sample');

        const emptyReport = store.getPeriodReport('2025-01-01', '2025-01-31');
        if (emptyReport.entries.length !== 0) {
          throw new Error('Expected 0 entries in empty report');
        }
        if (emptyReport.total_period_seconds !== 0) {
          throw new Error('Expected 0 total seconds in empty report');
        }
        if (emptyReport.employees_summary.length !== 2) {
          throw new Error('Expected all 2 employees in summary with 0 seconds');
        }

        let invertedRejected = false;
        try {
          store.getPeriodReport('2026-05-10', '2026-05-01');
        } catch (e) {
          if (e instanceof TrackerError && e.statusCode === 400) invertedRejected = true;
        }
        if (!invertedRejected) throw new Error('date_from > date_to was not rejected');
      } finally {
        store.close();
      }
    }
  );

  return results;
}
