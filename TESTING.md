# Testing

How Project Hub is tested, how to run every suite, and the latest results.
Results below are from **14 October 2026**, against commit `a99f17d` (local) and the AWS deployment at https://d37hjhs1g613o6.cloudfront.net.

## Summary

| Layer | Tool | Tests | Result | Coverage |
|---|---|---|---|---|
| Backend unit + integration | pytest (+ pytest-cov) against a real PostgreSQL `pm_test` database | **372** | ✅ all pass | **98%** of backend code (2,163 statements, 37 uncovered) |
| Frontend components + services | Vitest + React Testing Library | **168** | ✅ all pass | **91.5% lines**, 90.2% statements, 86.4% branches, 82.7% functions |
| End-to-end (browser) | Playwright (Chromium desktop + Pixel 7 mobile) | **20 journeys** | ✅ all pass locally (18 also on AWS; 2 new pending deploy) | all critical user paths (below) |
| Accessibility | axe-core in Playwright, WCAG 2.0/2.1/2.2 A and AA | **5 scans, 20+ screens** | ✅ no violations | every page for every role, key dialogs, error states, phone menu |
| Live API smoke test | `bin/smoke-test.sh` (curl) | **75 checks** | ✅ 75/75 **locally and on AWS** | every service and business rule |
| Load | Artillery | 700 virtual users, 4,200 requests | ✅ 0 errors on AWS | see [Performance](#performance) |
| Static analysis | ruff (Python), ESLint (JS), bandit (security), npm audit | - | ✅ all clean | - |

Rubric targets (`docs/full-stack.md`): backend ≥ 80% ✅ (98%), frontend ≥ 80% ✅ (91.5% lines, 82.7% functions), API endpoints ≥ 90% ✅, error handling ≥ 90% ✅, critical paths 100% E2E ✅.

## How to run

```sh
# Backend (needs local PostgreSQL; tests create and reset a separate pm_test database)
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest                                # tests + coverage report
.venv/bin/ruff check . && .venv/bin/ruff format --check .
cd .. && backend/.venv/bin/bandit -r ./backend  # the same security scan CI runs

# Frontend
cd frontend
npm test                                        # Vitest
npx vitest run --coverage                       # with coverage
npm run lint
npm audit --audit-level=high                    # the same check CI runs

# End-to-end (start the app first: ./bin/start-dev.sh)
npx playwright install chromium                 # once
npm run e2e                                     # local
../bin/e2e-live.sh                              # AWS: reads the demo passwords from CloudWatch; add --ui or --headed to watch

# Live smoke test (local by default)
./bin/smoke-test.sh
SMOKE_ADMIN_PASSWORD=... SMOKE_MANAGER_PASSWORD=... SMOKE_EMPLOYEE_PASSWORD=... ./bin/smoke-test.sh https://<cloudfront>

# Load test
npx artillery@2 run loadtest/api-load.yml --target https://<cloudfront> --variables '{"password":"<MM4R8T password>"}'
```

On AWS the demo passwords are random; see the README's *Deploying to AWS* section for where to find them.

## Backend tests (pytest)

Every service is tested by calling its real Lambda `handler()` with Function URL events, against a **real PostgreSQL database** that is dropped, re-migrated and re-seeded for each test - so tests are independent and never touch development data.

| Area | What is proven |
|---|---|
| Core library | Router (paths with/without the CloudFront prefix, 404/405, JSON errors, hidden internals on 500), validation (every field type and message), password hashing, working days, peak-load and budget arithmetic, insight rules |
| Auth | Login, refresh, me, logout; forced change of admin-issued passwords (other endpoints blocked until done, password rules, wrong current password, reset forces it again, existing accounts untouched); generic errors for unknown IDs; lockout after 5 failures; expired vs invalid tokens; inactive accounts; tokens signed with another secret |
| RBAC | Every role × every endpoint; role changes and deactivation take effect without a new token; denied writes audited |
| Users | Generated IDs and one-time passwords; reporting-line, last-admin and self-protection rules; salary visibility; self-service limited to name/email |
| Projects | Visibility per role; archive (read-only, hidden, never deleted) and reactivate; manager-only fields |
| Staffing | 40-hour rule incl. non-overlapping projects; budget exact fit vs one cent over; dates/budget changes re-checked; reductions always allowed; **concurrency: two simultaneous requests for the last free hours - exactly one succeeds** |
| Approvals | Cross-team requests (incl. admin-made) pending for the employee's manager only; reserved hours; approve/reject/increase/reduce; denied attempts audited |
| Milestones | Date rules, dependency rules, cycles, start/reopen rules, delete protection, progress and overdue tracking; can't complete with open tasks |
| Tasks | Assignee must be an approved team member; only the assignee, project manager or an admin can tick off (others refused and audited, outsiders 404); waiting on milestone dependencies; completed milestones take no new/reopened tasks; deleting a milestone deletes its tasks; removing someone unassigns their open tasks; archived projects read-only; tasks scoped to their project; dashboard list |
| Requests | Submit/withdraw/approve/reject; approval creates the project in the same transaction; failed approval creates nothing |
| Audit | Managers see only their own and their direct reports' entries (other teams, managers, admins hidden; filters, counts and pagination stay in scope; reassignment moves history); same-transaction writes, rollback leaves no entry, append-only (UPDATE/DELETE/TRUNCATE rejected by the database), redaction, filters, no write routes |
| Monitor | Flags each over-budget change once, records recovery, admin-only trigger, scheduled events can't be forged over HTTP |
| Regressions | Cross-connection lock deadlock (denied-attempt audit vs a locked row) - fixed with `FOR NO KEY UPDATE` and a lock timeout |

## Frontend tests (Vitest + React Testing Library)

Vitest is used instead of Jest: it is Vite's native runner with a Jest-compatible API (`describe`/`it`/`expect`/mocks), and React Testing Library is used as the rubric asks.

- **API client:** success, 204, error shape, network errors, the CloudFront HTML fallback, token refresh and retry, single shared refresh, session expiry.
- **API service functions** (mocked responses): every users and audit call sends the right method, URL, query string and body, passes abort signals through, and turns error responses into typed errors.
- **Auth:** login form validation and errors, session restore, sign-out, route guards and permission guards.
- **Pages and components:** users, projects, project detail (budget card, insights, archive/reactivate), team and assignment dialog (live cost/availability preview, approval note), milestones timeline and dialog, approvals, requests, audit log, role dashboards, badges and polling.

## End-to-end tests (Playwright)

Run in real Chromium against the running app and backend; each run creates uniquely named projects and archives them afterwards.

| Journey | Covers |
|---|---|
| Each role lands on its own dashboard | Sign-in for all roles, role dashboards, sign-out |
| Wrong password is refused | Error message on the login form |
| **New hire** | Admin creates a user (initials-based ID) → the new hire signs in with the temporary password, is held on *Choose a new password* even when typing another URL → sets a password → lands on their dashboard → admin deactivates the test account |
| Employees cannot reach admin pages, even by URL | Hidden navigation + route guards (Users, Audit log) |
| Signed-out visitors are sent to sign in | Protected routes |
| **Core journey** | Admin creates a project → manager adds a milestone and staffs an employee (live cost preview) → employee sees the project and their hours → admin archives it |
| Budget rule in the UI | The assign dialog blocks staffing beyond the budget |
| **Cross-team approval** | Admin requests an employee's hours → their manager approves from the Approvals page → the decision appears in the project's audit history |
| Cross-team rejection | The employee's manager rejects with a reason → the request disappears and the reserved hours are freed |
| **Project request approved** | Manager submits a request → admin approves it → the project exists, managed by the requester, linked from the request |
| Project request rejected | A reason is required → the manager sees the admin's reason on the request |
| **Milestone dependencies** | A dependent milestone can't start before its dependency is due, or be in progress before it is completed; completing the dependency unblocks it; progress updates |
| Archive and reactivate | Archived projects are read-only and hidden from the default list, found under *Archived*, and can be reactivated |
| **Profile edit is audited** | An employee can edit only name/email → the admin sees the change in the audit log with before/after values |
| Failed sign-ins are audited | A wrong password appears in the audit log filtered to *Denied* |
| **Managers' scoped audit log** | A manager sees their employee's profile edit (with before/after) but not the admin creating their project |
| **Tasks** | Manager staffs Eli, plans two dependent milestones and gives Eli a task in each → completing a milestone with an open task is refused → Eli ticks his task off from the dashboard while the dependent one stays locked → the manager sees progress, completes the milestone, and the tick is in the project history (with axe scans of the open checklists and the dashboard) |
| Budget monitor on demand | Admin runs the budget check from the dashboard |
| Dashboard navigation | Dashboard tiles link to the matching pages |
| Mobile layout (Pixel 7) | Slide-out navigation |

**Result:** 20/20 journeys locally; the 18 earlier journeys also pass against AWS (the two new ones run there after the next deploy).

### Accessibility (axe)

`e2e/accessibility.e2e.js` runs [axe-core](https://github.com/dequelabs/axe-core) against WCAG 2.0, 2.1 and 2.2 at levels A and AA on the sign-in page (with and without validation errors), every page for each role, the audit log with an entry expanded, project detail, the new project/user/request dialogs (with errors), and the phone layout with the menu open. A failure lists each rule and the offending elements.

The first scan found two real issues, both fixed: sidebar links were direct children of a list (now wrapped in list items), and loading placeholders had a label but no role (now `progressbar`). Colour contrast passes in the dark theme.

**Result:** 5/5, no violations; the full Playwright suite is 25/25 locally (≈3.4 min).

To watch the journeys run (e.g. for a demo), from `frontend/`: `npx playwright test --ui` (pick and replay tests step by step), or `npx playwright test --headed --project=desktop` (a real browser window).

## Performance

Artillery, against the **AWS deployment**, 2-minute profile: 20 s warm-up at 1 user/s, 40 s ramp from 2 to 8 users/s, 60 s at 8 users/s. Each virtual user signs in as a manager and loads the dashboard, project list, a project, its team and its milestones.

| Metric | Result |
|---|---|
| Virtual users | 700 created, **700 completed, 0 failed** |
| Requests | **4,200, all HTTP 200**, ~35 requests/s sustained |
| All requests | median **40 ms**, p95 925 ms, max 969 ms |
| Sign-in (`POST /api/auth/login`) | median 907 ms, p95 944 ms |
| Data endpoints (dashboard, projects, project, team, milestones) | median **34-42 ms**, p95 **57-63 ms** |

Sign-in is deliberately expensive: passwords are hashed with PBKDF2 (120,000 rounds) on the smallest Lambda size, which also slows brute-force attempts. All other endpoints stay well under 100 ms at p95. The run's thresholds (p95 < 2 s, error rate < 1%) pass.

**Monitoring:** every request is logged with method, path, status, duration and request ID to CloudWatch, and unexpected errors return that request ID to the client so a user's report can be matched to the log line.

## Manual validation checklist

Run against the deployed app after each release (the smoke test automates the API side of all of these):

- [x] Each role signs in and sees the right dashboard and navigation
- [x] Admin creates a user; the one-time password works; reset and deactivate/reactivate work
- [x] Admin creates a project; manager edits schedule/budget but not name/manager
- [x] Staffing beyond 40 h/week or beyond the budget is refused with a clear message
- [x] Cross-team hours wait for the employee's manager; approve/reject behave as described
- [x] Milestone dependency rules hold; the timeline and progress update
- [x] Tasks: assign to a team member, tick off as the assignee, blocked by dependencies and by completed milestones
- [x] Managers' audit log shows only their own and their direct reports' activity
- [x] Project requests: submit, withdraw, approve (creates the project), reject (reason required)
- [x] Audit log shows every action above, including denied attempts, with before/after values
- [x] Deep links and refreshes work on CloudFront; works at phone width

## Known gaps

- **Frontend function coverage is 82.9%** (lines 91.7%). The uncovered functions are mostly small inline event handlers (dialog cancel buttons, menu close handlers) whose behaviour is exercised by the E2E suite.
- **The 2% of backend code not covered** is defensive handling of failures that are hard to provoke locally: resetting a dropped database connection, the cloud-only SSL setting, an audit write that itself fails, and a few rarely used filter branches.
- **The hourly budget-monitor schedule is only exercised on LocalStack.** On AWS the participant role is denied EventBridge (see README → Known limitations); the on-demand trigger is tested on both.
- **Load testing used one demo manager account** for all virtual users (realistic per-request cost, but not many distinct users' data).
- **Automated accessibility checks catch roughly half of WCAG issues.** axe covers contrast, names, roles and structure; keyboard-only and screen-reader walkthroughs were not done as a formal audit.
