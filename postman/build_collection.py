"""
Builds project-hub.postman_collection.json, the Postman/Newman API test suite.

The suite is one ordered journey through every service. It signs in as each
demo role, creates its own clearly named data ("Postman API test <run id> (safe
to ignore)"), checks the happy paths and the refusals (400/401/403/404/409) at
each step, and archives or deactivates what it created at the end.

The collection JSON is generated so the test scripts stay readable here
instead of as escaped strings. After editing this file:

    python3 postman/build_collection.py

Run it with ./bin/api-tests.sh (Newman), or import the JSON and an environment
from postman/ into Postman and use "Run collection".
"""

import json
from pathlib import Path

OUT = Path(__file__).with_name("project-hub.postman_collection.json")

# ----------------------------------------------------------------------------- helpers


def status(code: int) -> str:
    return f'pm.test("Status is {code}", () => pm.response.to.have.status({code}));'


def error(code: str) -> str:
    return f'pm.test("Error code is {code}", () => pm.expect(pm.response.json().error.code).to.eql("{code}"));'


def detail(field: str, text: str | None = None) -> str:
    """The validation error names ``field`` (and its message contains ``text``)."""
    if text is None:
        return (
            f'pm.test("Reports a problem with {field}", () => '
            f'pm.expect(pm.response.json().error.details).to.have.property("{field}"));'
        )
    return (
        f'pm.test("{field}: {text}", () => '
        f"pm.expect(pm.response.json().error.details.{field}).to.include({json.dumps(text)}));"
    )


def message(text: str) -> str:
    return (
        f"pm.test({json.dumps('Explains: ' + text)}, () => "
        f"pm.expect(pm.response.json().error.message).to.include({json.dumps(text)}));"
    )


def check(name: str, *lines: str) -> str:
    """A named assertion; ``body`` is the parsed JSON response."""
    inner = "\n    ".join(lines)
    return f"pm.test({json.dumps(name)}, () => {{\n    const body = pm.response.json();\n    {inner}\n}});"


def save(variable: str, expression: str) -> str:
    """Store a value for later requests (only on success). Stored as text, so tests compare with String(id)."""
    return f'if (pm.response.code < 300) pm.collectionVariables.set("{variable}", String({expression}));'


TOKENS = {
    "admin": "{{adminToken}}",
    "manager": "{{managerToken}}",
    "employee": "{{employeeToken}}",
}


def request(
    name: str,
    method: str,
    path: str,
    as_: str | None,
    body: dict | None = None,
    tests: tuple[str, ...] = (),
    pre: tuple[str, ...] = (),
    description: str = "",
    token: str | None = None,
) -> dict:
    """One Postman request. ``as_`` is the signed-in role (None = no token)."""
    raw_path, _, query = path.partition("?")
    url = {
        "raw": "{{baseUrl}}" + path,
        "host": ["{{baseUrl}}"],
        "path": [p for p in raw_path.split("/") if p],
    }
    if query:
        url["query"] = [
            {"key": k, "value": v}
            for k, _, v in (pair.partition("=") for pair in query.split("&"))
        ]
    item: dict = {
        "name": name,
        "request": {
            "method": method,
            "header": [],
            "url": url,
            "description": description,
        },
        "event": [],
    }
    bearer = token or (TOKENS[as_] if as_ else None)
    item["request"]["auth"] = (
        {
            "type": "bearer",
            "bearer": [{"key": "token", "value": bearer, "type": "string"}],
        }
        if bearer
        else {"type": "noauth"}
    )
    if body is not None:
        item["request"]["header"].append(
            {"key": "Content-Type", "value": "application/json"}
        )
        item["request"]["body"] = {"mode": "raw", "raw": json.dumps(body, indent=2)}
    if pre:
        item["event"].append(
            {
                "listen": "prerequest",
                "script": {
                    "type": "text/javascript",
                    "exec": "\n".join(pre).split("\n"),
                },
            }
        )
    if tests:
        item["event"].append(
            {
                "listen": "test",
                "script": {
                    "type": "text/javascript",
                    "exec": "\n".join(tests).split("\n"),
                },
            }
        )
    return item


def folder(name: str, description: str, items: list[dict]) -> dict:
    return {"name": name, "description": description, "item": items}


# ----------------------------------------------------------------------------- the journey

SETUP = """// A short id makes this run's records unique and easy to spot ("safe to ignore").
const runId = Date.now().toString(36).toUpperCase();
pm.collectionVariables.set("runId", runId);
// An employee ID that can never exist (real IDs avoid look-alikes such as 0, O, 1, I, L),
// so the failed sign-in below can never lock out a real account.
pm.collectionVariables.set("unknownId", "ZZ0" + runId.slice(-3));
// Dates about two years ahead, so the test project never overlaps anyone's real hours.
const day = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
pm.collectionVariables.set("startDate", day(700));
pm.collectionVariables.set("endDate", day(790));
pm.collectionVariables.set("designDue", day(720));
pm.collectionVariables.set("buildDue", day(750));
pm.collectionVariables.set("beforeStart", day(690));"""

PROJECT_PATH = "/api/projects/{{projectId}}"

NUMERIC_IDS = (
    '// Saved ids are strings; the API wants JSON numbers, so "{{id}}" placeholders are replaced unquoted.',
    "let raw = pm.request.body.raw;",
    "for (const name of ['managerUserId', 'employeeUserId', 'newHireId', 'adminUserId', 'designId', 'buildId']) {",
    "    raw = raw.split('\"{{' + name + '}}\"').join(pm.collectionVariables.get(name));",
    "}",
    "pm.request.body.update(raw);",
)


health = folder(
    "0. Health",
    "The API and database are up. No sign-in needed.",
    [
        request(
            "API and database are up",
            "GET",
            "/api/health",
            None,
            pre=(SETUP,),
            tests=(
                status(200),
                check(
                    "Database is reachable and migrated",
                    'pm.expect(body.status).to.eql("ok");',
                    'pm.expect(body.database).to.eql("ok");',
                    "pm.expect(body.schema_version).to.be.at.least(7);",
                ),
            ),
        ),
        request(
            "Unsupported methods get 405",
            "DELETE",
            "/api/health",
            None,
            tests=(status(405), error("method_not_allowed")),
        ),
    ],
)

auth = folder(
    "1. Auth",
    "Sign in as each demo role and store the tokens used by the rest of the suite.",
    [
        request(
            "Unknown employee ID is refused",
            "POST",
            "/api/auth/login",
            None,
            body={"employee_id": "{{unknownId}}", "password": "wrong-pass"},
            tests=(
                status(401),
                error("unauthorized"),
                message("Invalid employee ID or password"),
            ),
            description="Same response as a wrong password, so IDs can't be discovered. Attempts are audited.",
        ),
        request(
            "Missing fields are reported per field",
            "POST",
            "/api/auth/login",
            None,
            body={},
            tests=(
                status(400),
                error("validation_error"),
                detail("employee_id", "This field is required"),
                detail("password", "This field is required"),
            ),
        ),
        request(
            "Unknown fields are rejected",
            "POST",
            "/api/auth/login",
            None,
            body={
                "employee_id": "{{adminId}}",
                "password": "{{adminPassword}}",
                "remember_me": True,
            },
            tests=(status(400), detail("remember_me", "Unknown field")),
        ),
        request(
            "Admin signs in",
            "POST",
            "/api/auth/login",
            None,
            body={"employee_id": "{{adminId}}", "password": "{{adminPassword}}"},
            tests=(
                status(200),
                check(
                    "Returns tokens and the admin's profile",
                    "pm.expect(body.access_token).to.be.a('string');",
                    "pm.expect(body.refresh_token).to.be.a('string');",
                    "pm.expect(body.expires_in).to.eql(900);",
                    'pm.expect(body.user.role).to.eql("admin");',
                    "pm.expect(body.user).to.not.have.property('password_hash');",
                ),
                save("adminToken", "pm.response.json().access_token"),
                save("adminUserId", "pm.response.json().user.id"),
            ),
        ),
        request(
            "Manager signs in",
            "POST",
            "/api/auth/login",
            None,
            body={"employee_id": "{{managerId}}", "password": "{{managerPassword}}"},
            tests=(
                status(200),
                check(
                    "Signed in as a manager",
                    'pm.expect(body.user.role).to.eql("manager");',
                ),
                save("managerToken", "pm.response.json().access_token"),
                save("managerUserId", "pm.response.json().user.id"),
            ),
        ),
        request(
            "Employee signs in",
            "POST",
            "/api/auth/login",
            None,
            body={"employee_id": "{{employeeId}}", "password": "{{employeePassword}}"},
            tests=(
                status(200),
                check(
                    "Signed in as an employee who reports to the manager",
                    'pm.expect(body.user.role).to.eql("employee");',
                    'pm.expect(String(body.user.manager_id)).to.eql(pm.collectionVariables.get("managerUserId"));',
                ),
                save("employeeToken", "pm.response.json().access_token"),
                save("employeeRefreshToken", "pm.response.json().refresh_token"),
                save("employeeUserId", "pm.response.json().user.id"),
                save("employeeFirstName", "pm.response.json().user.first_name"),
            ),
        ),
        request(
            "No token is 401",
            "GET",
            "/api/auth/me",
            None,
            tests=(status(401), error("unauthorized")),
        ),
        request(
            "A forged token is 401",
            "GET",
            "/api/auth/me",
            None,
            token="not-a-real-token",
            tests=(status(401), message("Invalid authentication token")),
        ),
        request(
            "Me returns the signed-in user",
            "GET",
            "/api/auth/me",
            "employee",
            tests=(
                status(200),
                check(
                    "It's the employee",
                    'pm.expect(body.employee_id).to.eql(pm.variables.get("employeeId"));',
                    "pm.expect(body.must_change_password).to.eql(false);",
                ),
            ),
        ),
        request(
            "Refresh issues new tokens",
            "POST",
            "/api/auth/refresh",
            None,
            body={"refresh_token": "{{employeeRefreshToken}}"},
            tests=(
                status(200),
                check(
                    "New access token",
                    "pm.expect(body.access_token).to.be.a('string');",
                ),
                save("employeeToken", "pm.response.json().access_token"),
            ),
        ),
        request(
            "An access token can't be used to refresh",
            "POST",
            "/api/auth/refresh",
            None,
            body={"refresh_token": "{{employeeToken}}"},
            tests=(status(401),),
        ),
    ],
)

users = folder(
    "2. Users",
    "Account management and role checks. Creates one new hire (deactivated at the end).",
    [
        request(
            "Employees can't list users",
            "GET",
            "/api/users",
            "employee",
            tests=(status(403), error("forbidden")),
        ),
        request(
            "Admin searches users by name and role",
            "GET",
            "/api/users?q=Employee&role=employee",
            "admin",
            tests=(
                status(200),
                check(
                    "Only employees, including the demo employee",
                    "pm.expect(body.total).to.be.at.least(1);",
                    'body.items.forEach((u) => pm.expect(u.role).to.eql("employee"));',
                    'pm.expect(body.items.map((u) => u.employee_id)).to.include(pm.variables.get("employeeId"));',
                ),
            ),
        ),
        request(
            "Bad pagination is a 400",
            "GET",
            "/api/users?page=0&page_size=500",
            "admin",
            tests=(
                status(400),
                detail("page"),
                detail("page_size", "Must be between 1 and 100"),
            ),
        ),
        request(
            "Managers can't create accounts",
            "POST",
            "/api/users",
            "manager",
            body={
                "first_name": "No",
                "last_name": "Access",
                "email": "no.access@example.com",
                "salary": 1,
                "role": "admin",
            },
            tests=(status(403),),
        ),
        request(
            "Every invalid field is reported at once",
            "POST",
            "/api/users",
            "admin",
            body={
                "first_name": "",
                "last_name": "Tester",
                "email": "not-an-email",
                "salary": -1,
                "role": "boss",
            },
            tests=(
                status(400),
                detail("first_name", "This field is required"),
                detail("email", "valid email"),
                detail("salary", "at least 0"),
                detail("role", "Must be one of"),
            ),
        ),
        request(
            "Employees must have a manager",
            "POST",
            "/api/users",
            "admin",
            body={
                "first_name": "Postman",
                "last_name": "Newhire",
                "email": "postman.{{runId}}@example.com",
                "salary": 52000,
                "role": "employee",
            },
            tests=(status(400), detail("manager_id", "Employees must have a manager")),
        ),
        request(
            "Admin creates a new hire",
            "POST",
            "/api/users",
            "admin",
            body={
                "first_name": "Postman",
                "last_name": "Newhire",
                "email": "postman.{{runId}}@example.com",
                "job_title": "QA Analyst",
                "salary": 52000,
                "role": "employee",
                "manager_id": "{{managerUserId}}",
            },
            pre=NUMERIC_IDS,
            tests=(
                status(201),
                check(
                    "ID from the initials plus 4 characters, and a one-time password",
                    "pm.expect(body.user.employee_id).to.match(/^PN[A-Z0-9]{4}$/);",
                    "pm.expect(body.temporary_password).to.have.lengthOf(6);",
                    "pm.expect(body.user.is_active).to.eql(true);",
                ),
                save("newHireId", "pm.response.json().user.id"),
            ),
        ),
        request(
            "Email addresses are unique",
            "POST",
            "/api/users",
            "admin",
            body={
                "first_name": "Postman",
                "last_name": "Duplicate",
                "email": "POSTMAN.{{runId}}@example.com",
                "salary": 52000,
                "role": "manager",
            },
            tests=(status(400), detail("email", "already in use")),
        ),
        request(
            "Employees can only view themselves",
            "GET",
            "/api/users/{{managerUserId}}",
            "employee",
            tests=(status(403),),
        ),
        request(
            "Employees see their own salary",
            "GET",
            "/api/users/{{employeeUserId}}",
            "employee",
            tests=(
                status(200),
                check(
                    "Salary is visible to its owner",
                    "pm.expect(body.salary).to.be.a('number');",
                ),
            ),
        ),
        request(
            "Managers edit a direct report's job title",
            "PATCH",
            "/api/users/{{newHireId}}",
            "manager",
            body={"job_title": "Senior QA Analyst"},
            tests=(
                status(200),
                check(
                    "Updated", 'pm.expect(body.job_title).to.eql("Senior QA Analyst");'
                ),
            ),
        ),
        request(
            "Managers can't change salaries",
            "PATCH",
            "/api/users/{{newHireId}}",
            "manager",
            body={"salary": 1},
            tests=(status(400), detail("salary", "Unknown field")),
        ),
        request(
            "Anyone edits their own profile (PUT alias)",
            "PUT",
            "/api/users/me",
            "employee",
            body={"first_name": "{{employeeFirstName}}"},
            tests=(
                status(200),
                check(
                    "Name unchanged",
                    'pm.expect(body.first_name).to.eql(pm.variables.get("employeeFirstName"));',
                ),
            ),
        ),
    ],
)

projects = folder(
    "3. Projects",
    "Project CRUD and visibility. Creates the test project (archived at the end).",
    [
        request(
            "Managers can't create projects",
            "POST",
            "/api/projects",
            "manager",
            body={
                "name": "Nope",
                "start_date": "{{startDate}}",
                "predicted_end_date": "{{endDate}}",
                "budget": 1,
                "manager_id": "{{managerUserId}}",
            },
            pre=NUMERIC_IDS,
            tests=(status(403),),
        ),
        request(
            "The end date can't be before the start",
            "POST",
            "/api/projects",
            "admin",
            body={
                "name": "Backwards",
                "start_date": "{{endDate}}",
                "predicted_end_date": "{{startDate}}",
                "budget": 1,
                "manager_id": "{{managerUserId}}",
            },
            pre=NUMERIC_IDS,
            tests=(
                status(400),
                detail("predicted_end_date", "on or after the start date"),
            ),
        ),
        request(
            "Admin creates the test project",
            "POST",
            "/api/projects",
            "admin",
            body={
                "name": "Postman API test {{runId}} (safe to ignore)",
                "description": "Created by the Postman suite; archived when it finishes.",
                "start_date": "{{startDate}}",
                "predicted_end_date": "{{endDate}}",
                "budget": 60000,
                "status": "active",
                "manager_id": "{{managerUserId}}",
            },
            pre=NUMERIC_IDS,
            tests=(
                status(201),
                check(
                    "Created with budget figures and no team yet",
                    "pm.expect(body.budget).to.eql(60000);",
                    "pm.expect(body.projected_cost).to.eql(0);",
                    "pm.expect(body.team_size).to.eql(0);",
                    "pm.expect(body.working_days).to.be.above(0);",
                    'pm.expect(body.manager_employee_id).to.eql(pm.variables.get("managerId"));',
                ),
                save("projectId", "pm.response.json().id"),
            ),
        ),
        request(
            "Its manager can see it",
            "GET",
            PROJECT_PATH,
            "manager",
            tests=(status(200),),
        ),
        request(
            "Employees not on it get 404, not 403",
            "GET",
            PROJECT_PATH,
            "employee",
            tests=(status(404), error("not_found")),
            description="Projects you can't see are reported as missing, so their existence isn't revealed.",
        ),
        request(
            "Search finds it",
            "GET",
            "/api/projects?q={{runId}}",
            "admin",
            tests=(
                status(200),
                check(
                    "Exactly this project",
                    "pm.expect(body.total).to.eql(1);",
                    'pm.expect(String(body.items[0].id)).to.eql(pm.collectionVariables.get("projectId"));',
                ),
            ),
        ),
        request(
            "Its manager edits the description (PUT alias)",
            "PUT",
            PROJECT_PATH,
            "manager",
            body={"description": "Edited by its manager through PUT."},
            tests=(
                status(200),
                check(
                    "Updated", "pm.expect(body.description).to.include('through PUT');"
                ),
            ),
        ),
        request(
            "Managers can't rename projects",
            "PATCH",
            PROJECT_PATH,
            "manager",
            body={"name": "Renamed"},
            tests=(status(400), detail("name", "Unknown field")),
        ),
    ],
)

staffing = folder(
    "4. Staffing and approvals",
    "The 40-hour and budget rules, and cross-team approval by the employee's own manager.",
    [
        request(
            "Admin's staffing options need approval",
            "GET",
            PROJECT_PATH + "/staffing-options",
            "admin",
            tests=(
                status(200),
                check(
                    "The new hire is free, and admins need their manager's approval",
                    'const hire = body.items.find((o) => String(o.user_id) === pm.collectionVariables.get("newHireId"));',
                    "pm.expect(hire.available_hours).to.eql(40);",
                    "pm.expect(hire.needs_approval).to.eql(true);",
                ),
            ),
        ),
        request(
            "More than 40 hours a week is refused",
            "POST",
            PROJECT_PATH + "/assignments",
            "manager",
            body={"user_id": "{{employeeUserId}}", "hours_per_week": 41},
            pre=NUMERIC_IDS,
            tests=(status(400), detail("hours_per_week", "at most 40")),
        ),
        request(
            "A manager staffs their own report immediately",
            "POST",
            PROJECT_PATH + "/assignments",
            "manager",
            body={"user_id": "{{employeeUserId}}", "hours_per_week": 4},
            pre=NUMERIC_IDS,
            tests=(
                status(201),
                check(
                    "Approved straight away, with its cost",
                    'pm.expect(body.status).to.eql("approved");',
                    "pm.expect(body.hours_per_week).to.eql(4);",
                    "pm.expect(body.awaiting_approval).to.eql(false);",
                    "pm.expect(body.cost).to.be.above(0);",
                ),
                save("assignmentId", "pm.response.json().id"),
            ),
        ),
        request(
            "The same person can't be added twice",
            "POST",
            PROJECT_PATH + "/assignments",
            "manager",
            body={"user_id": "{{employeeUserId}}", "hours_per_week": 1},
            pre=NUMERIC_IDS,
            tests=(status(409), message("already on this project")),
        ),
        request(
            "The budget can't drop below the projected cost",
            "PATCH",
            PROJECT_PATH,
            "manager",
            body={"budget": 1},
            tests=(status(409), error("conflict"), message("over budget")),
        ),
        request(
            "Admin staffs someone else's report: pending",
            "POST",
            PROJECT_PATH + "/assignments",
            "admin",
            body={"user_id": "{{newHireId}}", "hours_per_week": 2},
            pre=NUMERIC_IDS,
            tests=(
                status(201),
                check(
                    "Pending, with the hours reserved",
                    'pm.expect(body.status).to.eql("pending");',
                    "pm.expect(body.hours_per_week).to.eql(null);",
                    "pm.expect(body.pending_hours).to.eql(2);",
                    "pm.expect(body.reserved_hours).to.eql(2);",
                ),
                save("newHireAssignmentId", "pm.response.json().id"),
            ),
        ),
        request(
            "The new hire's manager sees it waiting",
            "GET",
            "/api/projects/approvals",
            "manager",
            tests=(
                status(200),
                check(
                    "Listed as a new request for 2 hours",
                    'const item = body.items.find((i) => String(i.assignment_id) === pm.collectionVariables.get("newHireAssignmentId"));',
                    'pm.expect(item.kind).to.eql("new");',
                    "pm.expect(item.requested_hours).to.eql(2);",
                ),
            ),
        ),
        request(
            "Admins can't approve for the manager",
            "POST",
            PROJECT_PATH + "/assignments/{{newHireAssignmentId}}/approve",
            "admin",
            tests=(status(403),),
        ),
        request(
            "The employee's own manager approves",
            "POST",
            PROJECT_PATH + "/assignments/{{newHireAssignmentId}}/approve",
            "manager",
            tests=(
                status(200),
                check(
                    "Now approved",
                    'pm.expect(body.status).to.eql("approved");',
                    "pm.expect(body.hours_per_week).to.eql(2);",
                ),
            ),
        ),
        request(
            "Nothing is left to approve",
            "POST",
            PROJECT_PATH + "/assignments/{{newHireAssignmentId}}/approve",
            "manager",
            tests=(status(409), message("nothing awaiting approval")),
        ),
        request(
            "Employees see the team without costs",
            "GET",
            PROJECT_PATH + "/assignments",
            "employee",
            tests=(
                status(200),
                check(
                    "Two people, no money",
                    "pm.expect(body.items).to.have.lengthOf(2);",
                    "body.items.forEach((a) => pm.expect(a).to.not.have.property('cost'));",
                ),
            ),
        ),
        request(
            "Employees on the project see it, without the budget",
            "GET",
            PROJECT_PATH,
            "employee",
            tests=(
                status(200),
                check(
                    "Budget hidden, own hours shown",
                    "pm.expect(body.budget).to.eql(null);",
                    "pm.expect(body).to.not.have.property('projected_cost');",
                    "pm.expect(body.my_hours_per_week).to.eql(4);",
                ),
            ),
        ),
    ],
)

MILESTONES = PROJECT_PATH + "/milestones"
milestones = folder(
    "5. Milestones and tasks",
    "Dependencies, task checklists, who can tick tasks off, and how tasks gate milestones.",
    [
        request(
            "Manager adds milestone 'Design'",
            "POST",
            MILESTONES,
            "manager",
            body={
                "title": "Design",
                "start_date": "{{startDate}}",
                "due_date": "{{designDue}}",
            },
            tests=(
                status(201),
                check(
                    "Nothing blocks it",
                    "pm.expect(body.can_start).to.eql(true);",
                    "pm.expect(body.tasks).to.eql([]);",
                ),
                save("designId", "pm.response.json().id"),
            ),
        ),
        request(
            "Milestones can't start before the project",
            "POST",
            MILESTONES,
            "manager",
            body={
                "title": "Too early",
                "start_date": "{{beforeStart}}",
                "due_date": "{{designDue}}",
            },
            tests=(status(400), detail("start_date", "project start")),
        ),
        request(
            "A milestone can't start before its dependency is due",
            "POST",
            MILESTONES,
            "manager",
            body={
                "title": "Build",
                "start_date": "{{startDate}}",
                "due_date": "{{buildDue}}",
                "depends_on": ["{{designId}}"],
            },
            pre=NUMERIC_IDS,
            tests=(status(400), detail("start_date", "Design")),
        ),
        request(
            "Manager adds 'Build', which depends on 'Design'",
            "POST",
            MILESTONES,
            "manager",
            body={
                "title": "Build",
                "start_date": "{{designDue}}",
                "due_date": "{{buildDue}}",
                "depends_on": ["{{designId}}"],
            },
            pre=NUMERIC_IDS,
            tests=(
                status(201),
                check(
                    "Blocked by Design",
                    'pm.expect(body.depends_on.map((d) => d.title)).to.eql(["Design"]);',
                    'pm.expect(body.blocked_by).to.eql(["Design"]);',
                    "pm.expect(body.can_start).to.eql(false);",
                ),
                save("buildId", "pm.response.json().id"),
            ),
        ),
        request(
            "'Build' can't start until 'Design' is completed",
            "PATCH",
            MILESTONES + "/{{buildId}}",
            "manager",
            body={"status": "in_progress"},
            tests=(status(409), message("until these are completed: Design")),
        ),
        request(
            "Circular dependencies are refused",
            "PATCH",
            MILESTONES + "/{{designId}}",
            "manager",
            body={"depends_on": ["{{buildId}}"]},
            pre=NUMERIC_IDS,
            tests=(status(409), message("circular dependency")),
        ),
        request(
            "Tasks only go to approved team members",
            "POST",
            MILESTONES + "/{{buildId}}/tasks",
            "manager",
            body={"title": "Not for the admin", "assignee_id": "{{adminUserId}}"},
            pre=NUMERIC_IDS,
            tests=(status(400), detail("assignee_id", "approved member")),
        ),
        request(
            "Employees can't add tasks",
            "POST",
            MILESTONES + "/{{buildId}}/tasks",
            "employee",
            body={"title": "Sneaky task"},
            tests=(status(403),),
        ),
        request(
            "Manager adds a task for the employee",
            "POST",
            MILESTONES + "/{{buildId}}/tasks",
            "manager",
            body={"title": "Write the API tests", "assignee_id": "{{employeeUserId}}"},
            pre=NUMERIC_IDS,
            tests=(
                status(201),
                check(
                    "Assigned, open, and waiting on Design",
                    'pm.expect(body.assignee.employee_id).to.eql(pm.variables.get("employeeId"));',
                    "pm.expect(body.done).to.eql(false);",
                    'pm.expect(body.waiting_on).to.eql(["Design"]);',
                ),
                save("taskId", "pm.response.json().id"),
            ),
        ),
        request(
            "Manager adds an unassigned task",
            "POST",
            MILESTONES + "/{{buildId}}/tasks",
            "manager",
            body={"title": "Review the API tests"},
            tests=(
                status(201),
                check("Unassigned", "pm.expect(body.assignee).to.eql(null);"),
                save("reviewTaskId", "pm.response.json().id"),
            ),
        ),
        request(
            "The task is on the employee's dashboard",
            "GET",
            "/api/projects/dashboard",
            "employee",
            tests=(
                status(200),
                check(
                    "Listed under My tasks, marked as waiting",
                    'pm.expect(body.role).to.eql("employee");',
                    'const task = body.my_tasks.find((t) => String(t.id) === pm.collectionVariables.get("taskId"));',
                    "pm.expect(task.milestone_title).to.eql('Build');",
                    "pm.expect(task.waiting).to.eql(true);",
                ),
                check(
                    "The project is on their schedule with its hours and milestones",
                    'const entry = body.schedule.find((p) => String(p.project_id) === pm.collectionVariables.get("projectId"));',
                    "pm.expect(entry.hours_per_week).to.eql(4);",
                    "pm.expect(entry.milestones.map((m) => m.title)).to.eql(['Design', 'Build']);",
                ),
            ),
        ),
        request(
            "Tasks wait for the milestone's dependencies",
            "POST",
            PROJECT_PATH + "/tasks/{{taskId}}/complete",
            "employee",
            tests=(
                status(409),
                message("can't be ticked off until these are completed: Design"),
            ),
        ),
        request(
            "Manager completes 'Design'",
            "PATCH",
            MILESTONES + "/{{designId}}",
            "manager",
            body={"status": "completed"},
            tests=(
                status(200),
                check(
                    "Completed",
                    'pm.expect(body.status).to.eql("completed");',
                    "pm.expect(body.completed_at).to.be.a('string');",
                ),
            ),
        ),
        request(
            "The assignee ticks their task off",
            "POST",
            PROJECT_PATH + "/tasks/{{taskId}}/complete",
            "employee",
            tests=(
                status(200),
                check(
                    "Done, by them",
                    "pm.expect(body.done).to.eql(true);",
                    "pm.expect(body.completed_by_name).to.be.a('string');",
                ),
            ),
        ),
        request(
            "Employees can't tick other tasks",
            "POST",
            PROJECT_PATH + "/tasks/{{reviewTaskId}}/complete",
            "employee",
            tests=(status(403),),
        ),
        request(
            "A milestone with open tasks can't be completed",
            "PATCH",
            MILESTONES + "/{{buildId}}",
            "manager",
            body={"status": "completed"},
            tests=(status(409), message("1 task(s) still open")),
        ),
        request(
            "Manager assigns the open task to the new hire (PUT alias)",
            "PUT",
            PROJECT_PATH + "/tasks/{{reviewTaskId}}",
            "manager",
            body={"assignee_id": "{{newHireId}}"},
            pre=NUMERIC_IDS,
            tests=(
                status(200),
                check(
                    "Reassigned",
                    'pm.expect(String(body.assignee.id)).to.eql(pm.collectionVariables.get("newHireId"));',
                ),
            ),
        ),
        request(
            "The project manager can tick any task",
            "POST",
            PROJECT_PATH + "/tasks/{{reviewTaskId}}/complete",
            "manager",
            tests=(status(200), check("Done", "pm.expect(body.done).to.eql(true);")),
        ),
        request(
            "Now 'Build' can be completed",
            "PATCH",
            MILESTONES + "/{{buildId}}",
            "manager",
            body={"status": "completed"},
            tests=(
                status(200),
                check(
                    "All tasks done",
                    "pm.expect(body.tasks_done).to.eql(2);",
                    "pm.expect(body.tasks_total).to.eql(2);",
                ),
            ),
        ),
        request(
            "Tasks in a completed milestone stay closed",
            "POST",
            PROJECT_PATH + "/tasks/{{taskId}}/reopen",
            "employee",
            tests=(status(409), message("Reopen the milestone first")),
        ),
        request(
            "Progress adds up",
            "GET",
            MILESTONES,
            "employee",
            tests=(
                status(200),
                check(
                    "2 of 2 milestones and tasks done",
                    "pm.expect(body.summary.percent_complete).to.eql(100);",
                    "pm.expect(body.summary.tasks_done).to.eql(2);",
                    "pm.expect(body.items.map((m) => m.title)).to.eql(['Design', 'Build']);",
                ),
            ),
        ),
    ],
)

REQUEST_BODY = {
    "name": "Postman request {{runId}} (safe to ignore)",
    "start_date": "{{startDate}}",
    "predicted_end_date": "{{endDate}}",
    "budget": 25000,
    "justification": "Created by the Postman suite.",
}
requests = folder(
    "6. Project requests",
    "Managers ask for projects; admins approve or reject with a reason.",
    [
        request(
            "Employees can't request projects",
            "POST",
            "/api/projects/requests",
            "employee",
            body=REQUEST_BODY,
            tests=(status(403),),
        ),
        request(
            "Manager requests a project",
            "POST",
            "/api/projects/requests",
            "manager",
            body=REQUEST_BODY,
            tests=(
                status(201),
                check("Pending", 'pm.expect(body.status).to.eql("pending");'),
                save("requestId", "pm.response.json().id"),
            ),
        ),
        request(
            "A rejection needs a reason",
            "POST",
            "/api/projects/requests/{{requestId}}/reject",
            "admin",
            body={},
            tests=(status(400), detail("note", "This field is required")),
        ),
        request(
            "Admin rejects with a reason",
            "POST",
            "/api/projects/requests/{{requestId}}/reject",
            "admin",
            body={"note": "Testing the rejection path."},
            tests=(
                status(200),
                check(
                    "Rejected, with the note",
                    'pm.expect(body.status).to.eql("rejected");',
                    "pm.expect(body.review_note).to.include('rejection path');",
                ),
            ),
        ),
        request(
            "A decided request can't be decided again",
            "POST",
            "/api/projects/requests/{{requestId}}/approve",
            "admin",
            body={},
            tests=(status(409), message("already been rejected")),
        ),
        request(
            "Manager submits another request",
            "POST",
            "/api/projects/requests",
            "manager",
            body=REQUEST_BODY,
            tests=(status(201), save("secondRequestId", "pm.response.json().id")),
        ),
        request(
            "...and withdraws it",
            "POST",
            "/api/projects/requests/{{secondRequestId}}/withdraw",
            "manager",
            tests=(
                status(200),
                check("Withdrawn", 'pm.expect(body.status).to.eql("withdrawn");'),
            ),
        ),
        request(
            "Managers list only their own requests",
            "GET",
            "/api/projects/requests?status=withdrawn",
            "manager",
            tests=(
                status(200),
                check(
                    "Their withdrawn requests",
                    'const mine = pm.collectionVariables.get("managerUserId");',
                    'body.items.forEach((r) => { pm.expect(String(r.requested_by)).to.eql(mine); pm.expect(r.status).to.eql("withdrawn"); });',
                    'pm.expect(body.items.map((r) => String(r.id))).to.include(pm.collectionVariables.get("secondRequestId"));',
                ),
            ),
        ),
    ],
)

audit = folder(
    "7. Audit log",
    "Everything above was recorded, and each role sees only what it should.",
    [
        request(
            "Every change on the project was audited",
            "GET",
            "/api/audit?project_id={{projectId}}&page_size=200",
            "admin",
            tests=(
                status(200),
                check(
                    "Creation, staffing, approval, milestones and tasks are all there",
                    "const actions = body.items.map((e) => e.action);",
                    "['project.create', 'project.update', 'assignment.create', 'assignment.request', 'assignment.approve',",
                    " 'milestone.create', 'milestone.update', 'task.create', 'task.update', 'task.complete']",
                    "    .forEach((a) => pm.expect(actions, a).to.include(a));",
                    'body.items.forEach((e) => pm.expect(String(e.project_id)).to.eql(pm.collectionVariables.get("projectId")));',
                ),
            ),
        ),
        request(
            "Refused attempts are audited too",
            "GET",
            "/api/audit?outcome=denied&actor={{employeeId}}&page_size=10",
            "admin",
            tests=(
                status(200),
                check(
                    "The employee's refused changes are recorded",
                    "pm.expect(body.total).to.be.at.least(3);",
                    'body.items.forEach((e) => pm.expect(e.outcome).to.eql("denied"));',
                ),
            ),
        ),
        request(
            "Managers see themselves and their reports, not admins",
            "GET",
            "/api/audit?project_id={{projectId}}&page_size=200",
            "manager",
            tests=(
                status(200),
                check(
                    "No admin entries; the employee's ticked task is visible",
                    "body.items.forEach((e) => pm.expect(e.actor_role).to.not.eql('admin'));",
                    "pm.expect(body.items.some((e) => e.action === 'task.complete' && e.actor_role === 'employee')).to.eql(true);",
                ),
            ),
        ),
        request(
            "Managers can't filter their way to admin entries",
            "GET",
            "/api/audit?role=admin",
            "manager",
            tests=(status(200), check("Nothing", "pm.expect(body.total).to.eql(0);")),
        ),
        request(
            "Employees can't read the audit log",
            "GET",
            "/api/audit",
            "employee",
            tests=(status(403),),
        ),
        request(
            "Action names for the filter menu",
            "GET",
            "/api/audit/actions",
            "admin",
            tests=(
                status(200),
                check(
                    "Includes task.complete",
                    "pm.expect(body.items).to.include('task.complete');",
                ),
            ),
        ),
    ],
)

monitor = folder(
    "8. Budget monitor",
    "The scheduled budget check, run on demand.",
    [
        request(
            "Only admins can run the budget check",
            "POST",
            "/api/monitor/run",
            "manager",
            tests=(status(403),),
        ),
        request(
            "Admin runs the budget check",
            "POST",
            "/api/monitor/run",
            "admin",
            tests=(
                status(200),
                check(
                    "Reports what it checked",
                    "pm.expect(body.checked).to.be.at.least(1);",
                    "pm.expect(body.newly_over_budget).to.be.an('array');",
                    "pm.expect(body.ran_at).to.be.a('string');",
                ),
            ),
        ),
    ],
)

cleanup = folder(
    "9. Clean up",
    "Archive the test project and deactivate the new hire (nothing is ever deleted), then sign out.",
    [
        request(
            "Admin archives the test project",
            "POST",
            PROJECT_PATH + "/archive",
            "admin",
            tests=(
                status(200),
                check("Archived", "pm.expect(body.is_archived).to.eql(true);"),
            ),
        ),
        request(
            "Archived projects are read-only",
            "PATCH",
            PROJECT_PATH,
            "admin",
            body={"description": "Too late"},
            tests=(status(409), message("read-only")),
        ),
        request(
            "Archived projects disappear for employees",
            "GET",
            PROJECT_PATH,
            "employee",
            tests=(status(404),),
        ),
        request(
            "Admin deactivates the new hire",
            "POST",
            "/api/users/{{newHireId}}/deactivate",
            "admin",
            tests=(
                status(200),
                check("Inactive", "pm.expect(body.is_active).to.eql(false);"),
            ),
        ),
        request(
            "Employee signs out",
            "POST",
            "/api/auth/logout",
            "employee",
            tests=(status(204),),
        ),
        request(
            "Manager signs out",
            "POST",
            "/api/auth/logout",
            "manager",
            tests=(status(204),),
        ),
        request(
            "Admin signs out", "POST", "/api/auth/logout", "admin", tests=(status(204),)
        ),
    ],
)

# Runs after every request.
COLLECTION_TESTS = """if (pm.response.code !== 204) {
    pm.test("Responds with JSON", () => pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json"));
}
if (pm.response.code >= 400) {
    pm.test("Errors use the standard shape", () => {
        const error = pm.response.json().error;
        pm.expect(error.code).to.be.a("string");
        pm.expect(error.message).to.be.a("string");
    });
}"""

VARIABLES = [
    "runId",
    "unknownId",
    "startDate",
    "endDate",
    "designDue",
    "buildDue",
    "beforeStart",
    "adminToken",
    "managerToken",
    "employeeToken",
    "employeeRefreshToken",
    "adminUserId",
    "managerUserId",
    "employeeUserId",
    "employeeFirstName",
    "newHireId",
    "projectId",
    "assignmentId",
    "newHireAssignmentId",
    "designId",
    "buildId",
    "taskId",
    "reviewTaskId",
    "requestId",
    "secondRequestId",
]

collection = {
    "info": {
        "name": "Project Hub API",
        "_postman_id": "6f1b8f0e-3c2a-4a59-9d1e-2b7f6c0a9e41",
        "description": (
            "End-to-end API tests for Project Hub. Run the whole collection in order: it signs in as each demo role, "
            "creates its own clearly named data, checks every rule and refusal, then archives what it created.\n\n"
            "Choose the **Project Hub - local** or **Project Hub - AWS** environment first (on AWS, fill in the three "
            "passwords). From a terminal: `./bin/api-tests.sh` or `./bin/api-tests.sh aws`.\n\n"
            "Reference: /api-docs.html on the site (OpenAPI 3, docs/api/openapi.yaml). "
            "Generated by postman/build_collection.py."
        ),
        "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    "auth": {"type": "noauth"},
    "event": [
        {
            "listen": "test",
            "script": {"type": "text/javascript", "exec": COLLECTION_TESTS.split("\n")},
        }
    ],
    "variable": [{"key": name, "value": ""} for name in VARIABLES],
    "item": [
        health,
        auth,
        users,
        projects,
        staffing,
        milestones,
        requests,
        audit,
        monitor,
        cleanup,
    ],
}

if __name__ == "__main__":
    OUT.write_text(json.dumps(collection, indent=2) + "\n")
    count = sum(len(f["item"]) for f in collection["item"])
    print(f"Wrote {OUT.name}: {count} requests in {len(collection['item'])} folders")
