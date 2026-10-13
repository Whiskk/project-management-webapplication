"""
Projects service.

Route modules register themselves on one shared router so the service stays
organised by sub-domain as it grows:

    project_routes     - project CRUD, archive / reactivate
    assignment_routes  - staffing with the 40-hour and budget rules
"""

import assignment_routes
import project_routes
from pm_core.http import Router

router = Router("projects")
project_routes.register(router)
assignment_routes.register(router)


def handler(event: dict | None = None, context: object = None) -> dict:
    """Lambda entry point."""
    return router.handle(event, context)
