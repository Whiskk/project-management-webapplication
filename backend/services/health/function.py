"""
Health service: reports API and database status.

GET /api/health is unauthenticated so deploy scripts, smoke tests and the
frontend can confirm the backend and database are reachable.
"""

from pm_core.db import transaction
from pm_core.http import Request, Response, Router, ok

router = Router("health")


@router.get("/")
def get_health(request: Request) -> Response:
    """Return service status and the applied database schema version."""
    with transaction() as cur:
        cur.execute("SELECT MAX(version) AS version FROM schema_version")
        schema_version = cur.fetchone()["version"]
    return ok({"status": "ok", "database": "ok", "schema_version": schema_version})


def handler(event: dict | None = None, context: object = None) -> dict:
    """Lambda entry point."""
    return router.handle(event, context)
