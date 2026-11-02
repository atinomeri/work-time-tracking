import express, { Request, Response } from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import {
  TimeTrackerStore,
  TrackerError,
  runIsolatedTestSuite,
} from './src/utils/tracker';

const PORT = 3000;
const DB_PATH = process.env.TIMETRACK_DB_PATH || path.resolve(process.cwd(), 'data', 'timetracker.db');

let store = new TimeTrackerStore(DB_PATH);
store.seedDemoDataIfEmpty();
let restartCount = 0;

function handleError(res: Response, err: unknown): void {
  if (err instanceof TrackerError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : 'Внутренняя ошибка сервера.';
  res.status(500).json({ error: message });
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/state', (_req: Request, res: Response) => {
    try {
      const nowIso = new Date().toISOString();
      const employees = store.listEmployees(nowIso);
      const activeTimers = store.getActiveTimers(nowIso);
      res.json({
        employees,
        active_timers: activeTimers,
        server_time_utc: nowIso,
        restart_count: restartCount,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post('/api/employees', (req: Request, res: Response) => {
    try {
      const employee = store.addEmployee(req.body?.name);
      res.status(201).json(employee);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post('/api/timers/start', (req: Request, res: Response) => {
    try {
      const timer = store.startTimer(req.body?.employee_id, req.body?.task_description);
      res.status(201).json(timer);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post('/api/timers/stop', (req: Request, res: Response) => {
    try {
      const record = store.stopTimer(req.body?.employee_id);
      res.json(record);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get('/api/reports', (req: Request, res: Response) => {
    try {
      const dateFrom = typeof req.query.date_from === 'string' ? req.query.date_from : '';
      const dateTo = typeof req.query.date_to === 'string' ? req.query.date_to : '';
      const report = store.getPeriodReport(dateFrom, dateTo);
      res.json(report);
    } catch (err) {
      handleError(res, err);
    }
  });

  // Simulates a server & database restart by closing the SQLite connection and re-instantiating from disk
  app.post('/api/simulate-restart', (_req: Request, res: Response) => {
    try {
      store.close();
      store = new TimeTrackerStore(DB_PATH);
      restartCount += 1;
      const nowIso = new Date().toISOString();
      res.json({
        message: 'Соединение с SQLite закрыто и переоткрыто с диска. Все активные таймеры сохранены.',
        restart_count: restartCount,
        employees: store.listEmployees(nowIso),
        active_timers: store.getActiveTimers(nowIso),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post('/api/tests/run', (_req: Request, res: Response) => {
    try {
      const results = runIsolatedTestSuite();
      const passedCount = results.filter((r) => r.passed).length;
      res.json({
        total: results.length,
        passed: passedCount,
        failed: results.length - passedCount,
        results,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TimeTrack server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
