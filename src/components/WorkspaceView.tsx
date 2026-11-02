import React, { useState } from 'react';
import type {
  Employee,
  ActiveTimerEntry,
  PeriodReport,
} from '../utils/tracker';
import {
  formatDurationHms,
  formatDurationHuman,
  formatIsoShort,
  getTodayUtcDate,
  getDaysOffsetUtcDate,
} from '../utils/format';

interface WorkspaceViewProps {
  employees: Employee[];
  activeTimers: ActiveTimerEntry[];
  report: PeriodReport | null;
  dateFrom: string;
  dateTo: string;
  nowMs: number;
  errorBanner: string | null;
  infoBanner: string | null;
  isSubmitting: boolean;
  onClearBanners: () => void;
  onAddEmployee: (name: string) => Promise<boolean>;
  onStartTimer: (employeeId: number, taskDescription: string) => Promise<boolean>;
  onStopTimer: (employeeId: number) => Promise<boolean>;
  onFilterReport: (from: string, to: string) => Promise<void>;
  onDateFromChange: (val: string) => void;
  onDateToChange: (val: string) => void;
}

export const WorkspaceView: React.FC<WorkspaceViewProps> = ({
  employees,
  activeTimers,
  report,
  dateFrom,
  dateTo,
  nowMs,
  errorBanner,
  infoBanner,
  isSubmitting,
  onClearBanners,
  onAddEmployee,
  onStartTimer,
  onStopTimer,
  onFilterReport,
  onDateFromChange,
  onDateToChange,
}) => {
  const [newEmployeeName, setNewEmployeeName] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number>(
    employees[0]?.id ?? 0
  );
  const [taskDescription, setTaskDescription] = useState('');

  // Keep selected employee synced when employee list loads or updates
  React.useEffect(() => {
    if (employees.length > 0 && !employees.some((e) => e.id === selectedEmployeeId)) {
      setSelectedEmployeeId(employees[0].id);
    }
  }, [employees, selectedEmployeeId]);

  const handleEmployeeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await onAddEmployee(newEmployeeName);
    if (ok) {
      setNewEmployeeName('');
    }
  };

  const handleTimerStartSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await onStartTimer(selectedEmployeeId, taskDescription);
    if (ok) {
      setTaskDescription('');
    }
  };

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onFilterReport(dateFrom, dateTo);
  };

  const applyQuickPreset = async (from: string, to: string) => {
    onDateFromChange(from);
    onDateToChange(to);
    await onFilterReport(from, to);
  };

  const selectedEmployee = employees.find((e) => e.id === selectedEmployeeId) || null;

  return (
    <div className="space-y-6">
      {/* Feedback Banners */}
      {errorBanner && (
        <div
          role="alert"
          data-testid="error-banner"
          className="flex items-center justify-between gap-4 px-4 py-3 text-sm text-red-900 bg-red-50 border border-red-200 rounded-lg"
        >
          <span>
            <strong className="font-semibold">Ошибка проверки: </strong>
            {errorBanner}
          </span>
          <button
            type="button"
            onClick={onClearBanners}
            className="px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-100 rounded transition-colors whitespace-nowrap shrink-0"
          >
            Скрыть
          </button>
        </div>
      )}

      {infoBanner && !errorBanner && (
        <div
          role="status"
          data-testid="info-banner"
          className="flex items-center justify-between gap-4 px-4 py-3 text-sm text-slate-800 bg-white border border-slate-200 rounded-lg"
        >
          <span>{infoBanner}</span>
          <button
            type="button"
            onClick={onClearBanners}
            className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded transition-colors whitespace-nowrap shrink-0"
          >
            Закрыть
          </button>
        </div>
      )}

      {/* Main 2-Column Workspace Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Controls & Active Timers (5 cols on desktop) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Card 1: Add Employee */}
          <section
            aria-labelledby="heading-add-employee"
            className="bg-white border border-slate-200 rounded-xl p-4"
          >
            <div className="mb-3">
              <h2
                id="heading-add-employee"
                className="text-base font-semibold text-slate-900"
              >
                01. Добавление сотрудника
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Имя проверяется на пустоту и уникальность в базе данных SQLite
              </p>
            </div>

            <form onSubmit={handleEmployeeSubmit} className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1">
                <label htmlFor="employee-name-input" className="sr-only">
                  Имя нового сотрудника
                </label>
                <input
                  id="employee-name-input"
                  type="text"
                  value={newEmployeeName}
                  onChange={(e) => setNewEmployeeName(e.target.value)}
                  placeholder="Например: Elena Petrova"
                  className="w-full px-3 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-blue-600"
                />
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-3.5 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Добавить сотрудника
              </button>
            </form>

            {/* Compact Employee Roster */}
            <div className="mt-3 pt-3 border-t border-slate-100">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                <span>Список сотрудников ({employees.length})</span>
                <span>Статус таймера</span>
              </div>
              <ul className="divide-y divide-slate-100 text-sm" data-testid="employee-list">
                {employees.map((emp) => (
                  <li
                    key={emp.id}
                    className="py-1.5 flex items-center justify-between gap-3"
                  >
                    <span className="font-medium text-slate-800 truncate">
                      {emp.name}
                    </span>
                    <span className="text-xs text-slate-500 whitespace-nowrap shrink-0">
                      {emp.active_timer ? (
                        <span className="text-emerald-700 font-medium">
                          В работе · #{emp.active_timer.id}
                        </span>
                      ) : (
                        <span>Свободен</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* Card 2: Start / Stop Timer */}
          <section
            aria-labelledby="heading-timer-control"
            className="bg-white border border-slate-200 rounded-xl p-4"
          >
            <div className="mb-3">
              <h2
                id="heading-timer-control"
                className="text-base font-semibold text-slate-900"
              >
                02. Управление таймером задачи
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Один активный таймер на сотрудника · старт пишется в БД (UTC ISO 8601)
              </p>
            </div>

            <form onSubmit={handleTimerStartSubmit} className="space-y-3">
              <div>
                <label
                  htmlFor="timer-employee-select"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Сотрудник
                </label>
                <select
                  id="timer-employee-select"
                  value={selectedEmployeeId}
                  onChange={(e) => setSelectedEmployeeId(Number(e.target.value))}
                  className="w-full px-3 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:bg-white focus:border-blue-600"
                >
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} {emp.active_timer ? '— [Таймер запущен]' : '— [Свободен]'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="timer-task-input"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Описание задачи
                </label>
                <input
                  id="timer-task-input"
                  type="text"
                  value={taskDescription}
                  onChange={(e) => setTaskDescription(e.target.value)}
                  placeholder="Напр.: Рефакторинг модуля отчётов"
                  className="w-full px-3 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-blue-600"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <button
                  type="submit"
                  disabled={isSubmitting || employees.length === 0}
                  className="px-3.5 py-1.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Запустить таймер
                </button>
                <button
                  type="button"
                  disabled={isSubmitting || !selectedEmployee}
                  onClick={() => selectedEmployee && onStopTimer(selectedEmployee.id)}
                  className="px-3.5 py-1.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Остановить выбранного
                </button>
              </div>
            </form>
          </section>

          {/* Card 3: Active Running Timers (Persisted in SQLite) */}
          <section
            aria-labelledby="heading-active-timers"
            className="bg-white border border-slate-200 rounded-xl p-4"
          >
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <div>
                <h2
                  id="heading-active-timers"
                  className="text-base font-semibold text-slate-900"
                >
                  03. Активные таймеры в БД ({activeTimers.length})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Сохраняются в таблице <code className="font-mono">time_entries</code> при перезапуске
                </p>
              </div>
            </div>

            {activeTimers.length === 0 ? (
              <div className="py-4 text-center border border-dashed border-slate-200 rounded-lg">
                <p className="text-sm text-slate-600">Сейчас нет активных таймеров</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Выберите сотрудника выше и введите описание задачи для старта
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200" data-testid="active-timers-list">
                {activeTimers.map((timer) => {
                  const liveElapsed = Math.max(
                    timer.elapsed_seconds,
                    Math.round((nowMs - Date.parse(timer.start_time)) / 1000)
                  );
                  return (
                    <div
                      key={timer.id}
                      className="py-2.5 first:pt-1 last:pb-1 flex items-center justify-between gap-4"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                          <span className="truncate">{timer.employee_name}</span>
                          <span className="text-slate-300" aria-hidden="true">·</span>
                          <span className="font-mono text-xs font-medium text-emerald-700 tabular-nums">
                            {formatDurationHms(liveElapsed)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-700 mt-0.5 truncate">
                          {timer.task_description}
                        </p>
                        <p className="text-xs font-mono text-slate-400 mt-0.5 tabular-nums">
                          Старт: {formatIsoShort(timer.start_time)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onStopTimer(timer.employee_id)}
                        aria-label={`Остановить таймер ${timer.employee_name}`}
                        className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Остановить
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Right Column: Period Report & Entries Table (7 cols on desktop) */}
        <div className="lg:col-span-7 space-y-6" id="period-report-section">
          {/* Card 4: Period Filter & Employee Totals */}
          <section
            aria-labelledby="heading-period-report"
            className="bg-white border border-slate-200 rounded-xl p-5"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
              <div>
                <h2
                  id="heading-period-report"
                  className="text-base font-semibold text-slate-900"
                >
                  04. Отчёт по времени за выбранный период
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Границы в UTC · записи на стыке дат усекаются строго по окну периода (Clipping)
                </p>
              </div>
              {report && (
                <div className="text-right">
                  <span className="text-xs text-slate-500 block">Итого по компании за период</span>
                  <span
                    data-testid="report-total-hms"
                    className="text-lg font-mono font-semibold text-slate-900 tabular-nums"
                  >
                    {formatDurationHms(report.total_period_seconds)}
                  </span>
                </div>
              )}
            </div>

            {/* Period Filter Form */}
            <form
              onSubmit={handleReportSubmit}
              className="grid grid-cols-1 sm:grid-cols-12 gap-3 pb-4 border-b border-slate-100 items-end"
            >
              <div className="sm:col-span-4">
                <label
                  htmlFor="report-date-from"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Дата начала (date_from)
                </label>
                <input
                  id="report-date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => onDateFromChange(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 tabular-nums focus:outline-none focus:bg-white focus:border-blue-600"
                />
              </div>

              <div className="sm:col-span-4">
                <label
                  htmlFor="report-date-to"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Дата окончания (date_to)
                </label>
                <input
                  id="report-date-to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => onDateToChange(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 tabular-nums focus:outline-none focus:bg-white focus:border-blue-600"
                />
              </div>

              <div className="sm:col-span-4 flex items-center gap-2">
                <button
                  type="submit"
                  className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Сформировать отчёт
                </button>
              </div>
            </form>

            {/* Quick Period Presets */}
            <div className="flex flex-wrap items-center gap-2 pt-3 pb-4 text-xs">
              <span className="text-slate-500 mr-1">Быстрый выбор:</span>
              <button
                type="button"
                onClick={() => applyQuickPreset(getTodayUtcDate(), getTodayUtcDate())}
                className="px-2.5 py-1 font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Только сегодня (проверка Clipping)
              </button>
              <button
                type="button"
                onClick={() => applyQuickPreset(getDaysOffsetUtcDate(-1), getTodayUtcDate())}
                className="px-2.5 py-1 font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Вчера и сегодня
              </button>
              <button
                type="button"
                onClick={() => applyQuickPreset('2025-01-01', '2025-01-15')}
                className="px-2.5 py-1 font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Пустой период (2025-01)
              </button>
            </div>

            {/* Summary Table Per Employee */}
            <div className="mt-2">
              <h3 className="text-xs font-semibold text-slate-600 mb-2">
                Сводка общего времени по сотрудникам ({dateFrom} — {dateTo})
              </h3>
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left border-collapse text-sm" data-testid="summary-table">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-600">
                      <th className="py-2.5 px-3.5">Сотрудник</th>
                      <th className="py-2.5 px-3.5">Текущий статус</th>
                      <th className="py-2.5 px-3.5 text-right">Записей в периоде</th>
                      <th className="py-2.5 px-3.5 text-right">Общее время (ЧЧ:ММ:СС)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {report?.employees_summary.map((row) => (
                      <tr key={row.employee_id} className="hover:bg-slate-50/80">
                        <td className="py-2.5 px-3.5 font-medium text-slate-900">
                          {row.employee_name}
                        </td>
                        <td className="py-2.5 px-3.5 text-xs text-slate-500">
                          {row.has_active_timer ? (
                            <span className="text-emerald-700 font-medium">
                              Таймер запущен
                            </span>
                          ) : (
                            <span>Остановлен</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-mono text-slate-700 tabular-nums">
                          {row.entries_count}
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-mono font-semibold text-slate-900 tabular-nums">
                          {formatDurationHms(row.total_seconds)}{' '}
                          <span className="text-xs font-normal text-slate-500">
                            ({formatDurationHuman(row.total_seconds)})
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* Card 5: Detailed Time Entries Log */}
          <section
            aria-labelledby="heading-entries-log"
            className="bg-white border border-slate-200 rounded-xl p-5"
          >
            <div className="flex items-center justify-between gap-2 mb-3">
              <div>
                <h2
                  id="heading-entries-log"
                  className="text-base font-semibold text-slate-900"
                >
                  05. Детальные записи времени за период ({report?.entries.length ?? 0})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Все временные метки хранятся и отображаются в формате UTC (ISO 8601)
                </p>
              </div>
            </div>

            {!report || report.entries.length === 0 ? (
              <div
                data-testid="empty-report-state"
                className="py-8 px-4 text-center border border-dashed border-slate-200 rounded-lg"
              >
                <p className="text-sm font-medium text-slate-700">
                  За выбранный период ({dateFrom} — {dateTo}) завершённых записей нет
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  В сводной таблице выше у всех сотрудников отображается 00:00:00. Выберите текущий период или остановите активный таймер.
                </p>
                <button
                  type="button"
                  onClick={() => applyQuickPreset(getDaysOffsetUtcDate(-1), getTodayUtcDate())}
                  className="mt-3 px-3.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors cursor-pointer"
                >
                  Показать записи за вчера и сегодня
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left border-collapse text-sm" data-testid="entries-table">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-600">
                      <th className="py-2.5 px-3.5">Сотрудник и задача</th>
                      <th className="py-2.5 px-3.5">Интервал (UTC ISO 8601)</th>
                      <th className="py-2.5 px-3.5 text-right">Засчитано в периоде</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {report.entries.map((entry) => (
                      <tr key={entry.id} className="hover:bg-slate-50/80 align-top">
                        <td className="py-3 px-3.5">
                          <div className="font-medium text-slate-900">
                            {entry.employee_name}
                          </div>
                          <div className="text-xs text-slate-600 mt-0.5">
                            {entry.task_description}
                          </div>
                        </td>
                        <td className="py-3 px-3.5 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                          <div>С: {formatIsoShort(entry.start_time)}</div>
                          <div>По: {formatIsoShort(entry.end_time)}</div>
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono tabular-nums whitespace-nowrap">
                          <div className="font-semibold text-slate-900">
                            {formatDurationHms(entry.clipped_duration_seconds)}
                          </div>
                          {entry.is_clipped ? (
                            <div className="text-xs text-amber-700 mt-0.5">
                              Усечено по границе · всего {formatDurationHms(entry.raw_duration_seconds)}
                            </div>
                          ) : (
                            <div className="text-xs text-slate-400 mt-0.5">
                              Полная запись
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
