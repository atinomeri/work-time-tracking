Rules:
- Keep it small: no unnecessary libraries, no over-engineering, and no more than ~300 lines of application code if possible.
- Store timestamps in UTC, ISO 8601. The running timer must be stored as a start timestamp in the database, never only in memory, so it survives a restart.
- One active timer per employee at a time. Starting a second one or stopping a non-running one must return a clear error, not crash.
- Period filter: define explicitly how entries that cross the period boundaries are handled (e.g. clip to the period or include by start date) and document the choice in the README.
- Validate all input on the backend (empty task description, invalid dates, date_from > date_to, unknown employee).
- Add short comments only where the logic is non-obvious. Use meaningful names and no dead code.
- Tests must be independent and use a temporary database, not the real one.
- Do NOT invent or pre-write the "errors found and fixed" section of the README. Instead, after generating code, list the places where you are least sure it is correct, so I can verify them myself.
- If any requirement is ambiguous, ask one clarifying question before coding.