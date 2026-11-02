import React from 'react';
import type { TestCaseResult } from '../utils/tracker';

interface TestsAndDocsViewProps {
  activeSubTab: 'tests' | 'docs';
  testResults: TestCaseResult[];
  isRunningTests: boolean;
  onRunTests: () => Promise<void>;
}

export const TestsAndDocsView: React.FC<TestsAndDocsViewProps> = ({
  activeSubTab,
  testResults,
  isRunningTests,
  onRunTests,
}) => {
  const passedCount = testResults.filter((t) => t.passed).length;

  if (activeSubTab === 'tests') {
    return (
      <div className="space-y-6">
        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Автоматические тесты основных сценариев (Isolated Temp SQLite DB)
              </h2>
              <p className="text-sm text-slate-600 mt-1">
                Каждый тест создаёт собственную временную базу данных в <code className="font-mono text-xs">os.tmpdir()</code>, не затрагивая рабочие данные приложения.
              </p>
            </div>
            <button
              type="button"
              onClick={onRunTests}
              disabled={isRunningTests}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isRunningTests ? 'Выполнение...' : 'Запустить тесты заново'}
            </button>
          </div>

          <div className="mt-4 flex items-center gap-4 text-sm text-slate-700">
            <span>
              Всего проверок: <strong className="font-mono tabular-nums">{testResults.length}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span className="text-emerald-700 font-medium">
              Успешно: <strong className="font-mono tabular-nums">{passedCount}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Команда в терминале: <code className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded">npm test</code> или <code className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded">pytest python_version/test_app.py</code>
            </span>
          </div>

          <div className="mt-5 divide-y divide-slate-200 border border-slate-200 rounded-lg" data-testid="test-results-list">
            {testResults.map((tc) => (
              <div key={tc.id} className="p-4 flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-mono font-semibold ${
                        tc.passed ? 'text-emerald-700' : 'text-red-700'
                      }`}
                    >
                      {tc.passed ? '[PASS]' : '[FAIL]'}
                    </span>
                    <h3 className="text-sm font-semibold text-slate-900">{tc.name}</h3>
                  </div>
                  <p className="text-xs text-slate-600">{tc.description}</p>
                  {tc.error && (
                    <p className="text-xs font-mono text-red-700 mt-1">{tc.error}</p>
                  )}
                </div>
                <span className="text-xs font-mono text-slate-500 tabular-nums whitespace-nowrap shrink-0">
                  {tc.duration_ms} мс
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Architecture & Boundary Clipping Documentation */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">
          Документация проекта (README.md) и Пояснение решений
        </h2>
        <p className="text-sm text-slate-700 leading-relaxed">
          В репозитории подготовлены как полнофункциональная версия на <strong>TypeScript / Express / встроенном SQLite (<code className="font-mono text-xs">node:sqlite</code>)</strong>, так и компактная эталонная версия на <strong>Python 3.11+ / FastAPI / <code className="font-mono text-xs">sqlite3</code> / <code className="font-mono text-xs">pytest</code></strong> (в директории <code className="font-mono text-xs">python_version/</code>, менее 220 строк кода).
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
            <h3 className="text-sm font-semibold text-slate-900 mb-2">
              Запуск в 3 команды (Node.js 22+)
            </h3>
            <pre className="text-xs font-mono text-slate-800 overflow-x-auto leading-relaxed">
{`npm install
npm test
npm run dev`}
            </pre>
          </div>
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
            <h3 className="text-sm font-semibold text-slate-900 mb-2">
              Запуск в 3 команды (Python 3.11+ / FastAPI)
            </h3>
            <pre className="text-xs font-mono text-slate-800 overflow-x-auto leading-relaxed">
{`pip install -r python_version/requirements.txt
pytest python_version/test_app.py
uvicorn python_version.app:app --port 8000`}
            </pre>
          </div>
        </div>
      </section>

      {/* AI Tools, Prompts & Code Review Hotspots (Per CONSTRAINTS.md) */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h3 className="text-base font-semibold text-slate-900">
          Использованные ИИ-модели, примеры промтов и чек-лист для проверки кода
        </h3>

        <div className="space-y-3 text-sm text-slate-700">
          <p>
            <strong>ИИ-инструменты и модели:</strong> Google AI Studio Build (семейство моделей Gemini).
          </p>
          <div>
            <strong>Примеры запросов (промтов):</strong>
            <ul className="list-disc pl-5 mt-1.5 space-y-1.5 text-xs text-slate-600">
              <li>
                «Спроектируй схему SQLite для учёта рабочего времени (employees, time_entries), где активный таймер хранится как запись с end_time IS NULL и защищён частичным уникальным индексом WHERE end_time IS NULL».
              </li>
              <li>
                «Реализуй расчёт отчёта за период [date_from, date_to] в UTC с усечением записей, пересекающих полночь (Boundary Clipping), и строгой серверной валидацией некорректных дат».
              </li>
              <li>
                «Напиши изолированные автотесты на временной БД: добавление сотрудника, повторный старт таймера, выживание активного таймера при закрытии и повторном открытии SQLite-файла, и пустой отчёт».
              </li>
            </ul>
          </div>
        </div>

        <div className="pt-3 border-t border-slate-200">
          <h4 className="text-sm font-semibold text-slate-900 mb-2">
            Места в коде для самостоятельной верификации (вместо предзаполненного списка ошибок):
          </h4>
          <ol className="list-decimal pl-5 space-y-2 text-xs text-slate-700 leading-relaxed">
            <li>
              <strong>Усечение на правой границе суток (<code className="font-mono">23:59:59.999Z</code> vs полуоткрытый интервал <code className="font-mono">[date_from, date_to + 1 day)</code>):</strong> в <code className="font-mono">src/utils/tracker.ts</code> используется <code className="font-mono">Math.round((clippedEndMs - clippedStartMs) / 1000)</code>, чтобы 1 миллисекунда до полуночи не приводила к потере 1 секунды (3599 с вместо 3600 с). В <code className="font-mono">python_version/app.py</code> для этого использована полуоткрытая правая граница <code className="font-mono">d_to + timedelta(days=1)</code> в <code className="font-mono">00:00:00Z</code>.
            </li>
            <li>
              <strong>Фильтрация периодов в UTC и локальный часовой пояс браузера:</strong> все временные метки хранятся в UTC ISO 8601. Если пользователь запускает задачу в 01:00 ночи по Москве (UTC+3), в UTC это 22:00 предыдущего дня.
            </li>
            <li>
              <strong>Проверка несуществующих календарных дат (<code className="font-mono">2026-02-30</code>):</strong> стандартный <code className="font-mono">new Date("2026-02-30")</code> в JS молча переносит дату на март. В функции <code className="font-mono">parseStrictUtcDate</code> добавлена обратная сверка года, месяца и дня после конструирования <code className="font-mono">Date.UTC</code>.
            </li>
            <li>
              <strong>Невключение активного (незавершённого) таймера в сумму завершённых часов:</strong> в <code className="font-mono">total_seconds</code> входят только завершённые сессии (<code className="font-mono">end_time IS NOT NULL</code>), а активная задача отображается явно со статусом «Таймер запущен» и живым секундомером.
            </li>
          </ol>
        </div>
      </section>
    </div>
  );
};
