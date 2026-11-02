/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import type {
  Employee,
  ActiveTimerEntry,
  PeriodReport,
  TestCaseResult,
} from './utils/tracker';
import {
  getTodayUtcDate,
  getDaysOffsetUtcDate,
} from './utils/format';
import { WorkspaceView } from './components/WorkspaceView';
import { TestsAndDocsView } from './components/TestsAndDocsView';

type ActiveTab = 'workspace' | 'tests' | 'docs';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('workspace');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [activeTimers, setActiveTimers] = useState<ActiveTimerEntry[]>([]);
  const [report, setReport] = useState<PeriodReport | null>(null);
  const [dateFrom, setDateFrom] = useState<string>(() => getDaysOffsetUtcDate(-1));
  const [dateTo, setDateTo] = useState<string>(() => getTodayUtcDate());
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [restartCount, setRestartCount] = useState<number>(0);

  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [infoBanner, setInfoBanner] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const [testResults, setTestResults] = useState<TestCaseResult[]>([]);
  const [isRunningTests, setIsRunningTests] = useState<boolean>(false);

  // Live 1-second tick for running timer counters
  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const fetchState = useCallback(async () => {
    const res = await fetch('/api/state');
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Не удалось загрузить состояние сервера.');
    }
    setEmployees(data.employees || []);
    setActiveTimers(data.active_timers || []);
    setRestartCount(data.restart_count ?? 0);
  }, []);

  const fetchReport = useCallback(async (from: string, to: string) => {
    const params = new URLSearchParams({ date_from: from, date_to: to });
    const res = await fetch(`/api/reports?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Ошибка загрузки отчёта за период.');
    }
    setReport(data);
  }, []);

  const runBackendTests = useCallback(async () => {
    setIsRunningTests(true);
    try {
      const res = await fetch('/api/tests/run', { method: 'POST' });
      const data = await res.json();
      if (res.ok && Array.isArray(data.results)) {
        setTestResults(data.results);
      }
    } catch {
      // Ignore initial background test error
    } finally {
      setIsRunningTests(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await Promise.all([
          fetchState(),
          fetchReport(dateFrom, dateTo),
          runBackendTests(),
        ]);
      } catch (err) {
        setErrorBanner(err instanceof Error ? err.message : 'Ошибка инициализации.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddEmployee = async (name: string): Promise<boolean> => {
    setErrorBanner(null);
    setInfoBanner(null);
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorBanner(data.error || 'Не удалось добавить сотрудника.');
        return false;
      }
      await Promise.all([fetchState(), fetchReport(dateFrom, dateTo)]);
      setInfoBanner(`Сотрудник «${data.name}» добавлен в базу данных.`);
      return true;
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Ошибка сети.');
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartTimer = async (
    employeeId: number,
    taskDescription: string
  ): Promise<boolean> => {
    setErrorBanner(null);
    setInfoBanner(null);
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/timers/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: employeeId,
          task_description: taskDescription,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorBanner(data.error || 'Не удалось запустить таймер.');
        return false;
      }
      await Promise.all([fetchState(), fetchReport(dateFrom, dateTo)]);
      setInfoBanner(
        `Таймер для «${data.employee_name}» запущен (старт в UTC: ${data.start_time.slice(11, 19)}).`
      );
      return true;
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Ошибка сети.');
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStopTimer = async (employeeId: number): Promise<boolean> => {
    setErrorBanner(null);
    setInfoBanner(null);
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/timers/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: employeeId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorBanner(data.error || 'Не удалось остановить таймер.');
        return false;
      }
      await Promise.all([fetchState(), fetchReport(dateFrom, dateTo)]);
      setInfoBanner(
        `Таймер сотрудника «${data.employee_name}» остановлен. Запись сохранена в отчёт.`
      );
      return true;
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Ошибка сети.');
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFilterReport = async (from: string, to: string): Promise<void> => {
    setErrorBanner(null);
    setInfoBanner(null);
    try {
      await fetchReport(from, to);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Некорректный диапазон дат.'
      );
    }
  };

  const handleSimulateRestart = async () => {
    setErrorBanner(null);
    setInfoBanner(null);
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/simulate-restart', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setErrorBanner(data.error || 'Не удалось симулировать перезапуск.');
        return;
      }
      setEmployees(data.employees || []);
      setActiveTimers(data.active_timers || []);
      setRestartCount(data.restart_count ?? restartCount + 1);
      await fetchReport(dateFrom, dateTo);
      setInfoBanner(
        `${data.message} (Перезапусков за сессию: ${data.restart_count}, активных таймеров: ${data.active_timers.length}).`
      );
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Ошибка сети.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 bg-white border-b border-slate-200">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('workspace');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 font-display"
        >
          TimeTrack
        </a>

        {/* Zone 2: 4 concise single-line navigation links */}
        <nav aria-label="Основная навигация" className="flex items-center gap-6 text-sm font-medium text-slate-600">
          <a
            href="#workspace"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('workspace');
            }}
            className={`transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeTab === 'workspace'
                ? 'text-slate-900 border-blue-600 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Таймеры
          </a>
          <a
            href="#period-report-section"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('workspace');
              window.setTimeout(() => {
                document.getElementById('period-report-section')?.scrollIntoView({ behavior: 'smooth' });
              }, 50);
            }}
            className="transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 border-transparent hover:text-slate-900"
          >
            Отчёт за период
          </a>
          <a
            href="#tests"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('tests');
            }}
            className={`transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeTab === 'tests'
                ? 'text-slate-900 border-blue-600 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Автотесты ({testResults.filter((t) => t.passed).length}/{testResults.length || 5})
          </a>
          <a
            href="#docs"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('docs');
            }}
            className={`transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeTab === 'docs'
                ? 'text-slate-900 border-blue-600 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            README и Код
          </a>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={handleSimulateRestart}
            disabled={isSubmitting}
            className="px-3.5 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Проверить рестарт БД
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-6 py-6">
        {/* Contextual Workspace Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-4 border-b border-slate-200">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-display">
              Учёт рабочего времени сотрудников
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Хранилище: SQLite (WAL) · Часовой пояс: UTC (ISO 8601) · Активных таймеров: {activeTimers.length} · Проверенных перезапусков БД: {restartCount}
            </p>
          </div>
          <div className="text-xs font-mono text-slate-500 tabular-nums whitespace-nowrap">
            Текущее время UTC: {new Date(nowMs).toISOString().slice(0, 19).replace('T', ' ')}Z
          </div>
        </div>

        {activeTab === 'workspace' ? (
          <WorkspaceView
            employees={employees}
            activeTimers={activeTimers}
            report={report}
            dateFrom={dateFrom}
            dateTo={dateTo}
            nowMs={nowMs}
            errorBanner={errorBanner}
            infoBanner={infoBanner}
            isSubmitting={isSubmitting}
            onClearBanners={() => {
              setErrorBanner(null);
              setInfoBanner(null);
            }}
            onAddEmployee={handleAddEmployee}
            onStartTimer={handleStartTimer}
            onStopTimer={handleStopTimer}
            onFilterReport={handleFilterReport}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
          />
        ) : (
          <TestsAndDocsView
            activeSubTab={activeTab}
            testResults={testResults}
            isRunningTests={isRunningTests}
            onRunTests={runBackendTests}
          />
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white px-6 py-4 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>TimeTrack — Внутренний инструмент учёта рабочего времени (Вымышленные данные: Anna Test, Ivan Sample, Maria Example)</span>
          <span>Политика границ периода: усечение интервалов (Boundary Clipping в UTC)</span>
        </div>
      </footer>
    </div>
  );
}
