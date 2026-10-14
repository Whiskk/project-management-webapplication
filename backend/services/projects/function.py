"""
Projects service.

Layout:
    function.py     Lambda entry point; registers the route modules
    queries.py      project lookups, visibility rules and serialisation
    staffing.py     shared staffing rules (row locks, re-checks on project changes)
    routes/         one module per sub-domain:
        approvals    cross-team hours approval      } registered first: /approvals,
        requests     project requests               } /requests and /dashboard
        dashboard    role dashboards                } must not match /{id}
        projects     project CRUD, archive / reactivate
        assignments  staffing with the 40-hour and budget rules
        milestones   milestones with dependencies and tracking
        tasks        task checklists inside milestones; ticking tasks off
"""

from pm_core.http import Router
from routes import approvals, assignments, dashboard, milestones, projects, requests, tasks

router = Router("projects")
for module in (approvals, requests, dashboard, projects, assignments, milestones, tasks):
    module.register(router)


def handler(event: dict | None = None, context: object = None) -> dict:
    """Lambda entry point."""
    return router.handle(event, context)
