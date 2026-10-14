"""
Projects service.

Route modules register themselves on one shared router so the service stays
organised by sub-domain as it grows:

    approval_routes    - cross-team hours approval  } registered first: /approvals and
    request_routes     - project requests           } /requests must not match /{id}
    project_routes     - project CRUD, archive / reactivate
    assignment_routes  - staffing with the 40-hour and budget rules
    milestone_routes   - milestones with dependencies and tracking
"""

import approval_routes
import assignment_routes
import milestone_routes
import project_routes
import request_routes
from pm_core.http import Router

router = Router("projects")
approval_routes.register(router)
request_routes.register(router)
project_routes.register(router)
assignment_routes.register(router)
milestone_routes.register(router)


def handler(event: dict | None = None, context: object = None) -> dict:
    """Lambda entry point."""
    return router.handle(event, context)
