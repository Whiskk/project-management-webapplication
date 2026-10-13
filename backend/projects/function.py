"""
Projects service.

Route modules register themselves on one shared router so the service stays
organised by sub-domain as it grows (assignments, milestones and budget are
added in later slices):

    project_routes   - project CRUD, archive / reactivate
"""

import project_routes
from pm_core.http import Router

router = Router("projects")
project_routes.register(router)


def handler(event: dict | None = None, context: object = None) -> dict:
    """Lambda entry point."""
    return router.handle(event, context)
