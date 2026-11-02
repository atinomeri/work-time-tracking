import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  TimeTrackerStore,
  TrackerError,
  computeClippedDuration,
  parseStrictUtcDate,
} from './tracker';
import { formatDurationHms, formatDurationHuman } from './format';

function withTempStore(fn: (store: TimeTrackerStore, dbPath: string) => void): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timetrack-unit-'));
  const dbPath = path.join(tmpDir, 'tracker.db');
  const store = new TimeTrackerStore(dbPath);
  try {
    fn(store, dbPath);
  } finally {
    try {
      store.close();
    } catch {
      // already closed
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

test('1. Adding employees: trims whitespace and rejects empty or duplicate names', () => {
  withTempStore((store) => {
    const anna = store.addEmployee('  Anna Test  ', '2026-03-01T08:00:00.000Z');
    assert.equal(anna.name, 'Anna Test');
    assert.equal(anna.id, 1);

    assert.throws(
      () => store.addEmployee('   '),
      (err: unknown) => err instanceof TrackerError && err.statusCode === 400
    );

    assert.throws(
      () => store.addEmployee('anna test'),
      (err: unknown) => err instanceof TrackerError && err.statusCode === 409
    );
  });
});

test('2. Start and stop timer: enforces one active timer per employee and validates inputs', () => {
  withTempStore((store) => {
    const anna = store.addEmployee('Anna Test');
    const ivan = store.addEmployee('Ivan Sample');

    // Reject empty task description
    assert.throws(
      () => store.startTimer(anna.id, '   '),
      (err: unknown) => err instanceof TrackerError && err.statusCode === 400
    );

    // Reject unknown employee
    assert.throws(
      () => store.startTimer(999, 'Valid task'),
      (err: unknown) => err instanceof TrackerError && err.statusCode === 404
    );

    // Start timer for Anna
    const started = store.startTimer(anna.id, 'Implement SQLite storage', '2026-03-01T09:00:00.000Z');
    assert.equal(started.employee_name, 'Anna Test');
    assert.equal(started.task_description, 'Implement SQLite storage');

    // Starting a second timer for Anna must fail with 409
    assert.throws(
      () => store.startTimer(anna.id, 'Parallel task', '2026-03-01T09:10:00.000Z'),
      (err: unknown) => err instanceof TrackerError && err.statusCode === 409
    );

    // Ivan can still start his own timer independently
    store.startTimer(ivan.id, 'Frontend layout', '2026-03-01T09:05:00.000Z');

    // Stop Anna's timer after 90 minutes (5400 seconds)
    const stopped = store.stopTimer(anna.id, '2026-03-01T10:30:00.000Z');
    assert.equal(stopped.raw_duration_seconds, 5400);
    assert.equal(stopped.end_time, '2026-03-01T10:30:00.000Z');

    // Stopping Anna's timer again when none is running must fail with 400
    assert.throws(
      () => store.stopTimer(anna.id, '2026-03-01T10:35:00.000Z'),
      (err: unknown) => err instanceof TrackerError && err.statusCode === 400
    );
  });
});

test('3. Persistence across application restart: active timer survives DB close and reopen', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timetrack-restart-'));
  const dbPath = path.join(tmpDir, 'restart.db');
  try {
    const storeBeforeRestart = new TimeTrackerStore(dbPath);
    const anna = storeBeforeRestart.addEmployee('Anna Test');
    storeBeforeRestart.startTimer(anna.id, 'Long running migration', '2026-03-05T14:00:00.000Z');
    storeBeforeRestart.close();

    // Reopen fresh instance on the same SQLite database file
    const storeAfterRestart = new TimeTrackerStore(dbPath);
    try {
      const activeTimers = storeAfterRestart.getActiveTimers('2026-03-05T15:30:00.000Z');
      assert.equal(activeTimers.length, 1);
      assert.equal(activeTimers[0].employee_id, anna.id);
      assert.equal(activeTimers[0].task_description, 'Long running migration');
      assert.equal(activeTimers[0].start_time, '2026-03-05T14:00:00.000Z');
      assert.equal(activeTimers[0].elapsed_seconds, 5400);

      const finished = storeAfterRestart.stopTimer(anna.id, '2026-03-05T16:00:00.000Z');
      assert.equal(finished.raw_duration_seconds, 7200);
    } finally {
      storeAfterRestart.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('4. Total calculation for a selected period with boundary clipping', () => {
  withTempStore((store) => {
    const anna = store.addEmployee('Anna Test');
    const ivan = store.addEmployee('Ivan Sample');

    // Entry 1 (Anna): crosses start boundary of 2026-03-10
    // Starts 2026-03-09 23:00 UTC, ends 2026-03-10 01:00 UTC -> 2h raw, 1h (3600s) inside 2026-03-10
    store.startTimer(anna.id, 'Night deployment', '2026-03-09T23:00:00.000Z');
    store.stopTimer(anna.id, '2026-03-10T01:00:00.000Z');

    // Entry 2 (Anna): strictly inside 2026-03-10 (10:00 -> 12:30 UTC = 9000s)
    store.startTimer(anna.id, 'Feature implementation', '2026-03-10T10:00:00.000Z');
    store.stopTimer(anna.id, '2026-03-10T12:30:00.000Z');

    // Entry 3 (Ivan): outside period on 2026-03-08
    store.startTimer(ivan.id, 'Old task', '2026-03-08T10:00:00.000Z');
    store.stopTimer(ivan.id, '2026-03-08T12:00:00.000Z');

    const report = store.getPeriodReport('2026-03-10', '2026-03-10');
    assert.equal(report.entries.length, 2);
    assert.equal(report.total_period_seconds, 3600 + 9000);

    const annaSummary = report.employees_summary.find((e) => e.employee_id === anna.id);
    const ivanSummary = report.employees_summary.find((e) => e.employee_id === ivan.id);
    assert.ok(annaSummary);
    assert.ok(ivanSummary);
    assert.equal(annaSummary.total_seconds, 12600);
    assert.equal(annaSummary.entries_count, 2);
    assert.equal(ivanSummary.total_seconds, 0);
    assert.equal(ivanSummary.entries_count, 0);

    // Check clipping flag on the night deployment entry
    const clippedEntry = report.entries.find((e) => e.task_description === 'Night deployment');
    assert.ok(clippedEntry);
    assert.equal(clippedEntry.is_clipped, true);
    assert.equal(clippedEntry.raw_duration_seconds, 7200);
    assert.equal(clippedEntry.clipped_duration_seconds, 3600);
  });
});

test('5. Empty report and date validation (invalid format and date_from > date_to)', () => {
  withTempStore((store) => {
    store.addEmployee('Anna Test');
    store.addEmployee('Ivan Sample');

    const emptyReport = store.getPeriodReport('2026-01-01', '2026-01-07');
    assert.equal(emptyReport.entries.length, 0);
    assert.equal(emptyReport.total_period_seconds, 0);
    assert.equal(emptyReport.employees_summary.length, 2);
    assert.equal(emptyReport.employees_summary[0].total_seconds, 0);

    // date_from > date_to
    assert.throws(
      () => store.getPeriodReport('2026-03-15', '2026-03-10'),
      (err: unknown) => err instanceof TrackerError && err.statusCode === 400
    );

    // Invalid calendar date (Feb 30)
    assert.throws(
      () => parseStrictUtcDate('2026-02-30', 'date_from'),
      (err: unknown) => err instanceof TrackerError && err.statusCode === 400
    );

    // Direct unit check on computeClippedDuration
    const clip = computeClippedDuration(
      '2026-05-01T22:00:00.000Z',
      '2026-05-02T02:00:00.000Z',
      Date.parse('2026-05-02T00:00:00.000Z'),
      Date.parse('2026-05-02T23:59:59.999Z')
    );
    assert.equal(clip.rawSeconds, 14400);
    assert.equal(clip.clippedSeconds, 7200);
    assert.equal(clip.isClipped, true);

    assert.equal(formatDurationHms(5405), '01:30:05');
    assert.equal(formatDurationHuman(5405), '1ч 30м 5с');
  });
});
