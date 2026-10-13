"""
Shared pytest fixtures.

Integration tests run against a dedicated ``pm_test`` database on the local
PostgreSQL server, which is wiped and re-migrated for every test that uses
the ``fresh_db`` fixture. Development data in the main database is untouched.
"""

import importlib.util
import json
import os
import sys
from pathlib import Path
from types import ModuleType

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
TEST_DB = "pm_test"

# Configure the environment before pm_core is imported anywhere.
os.environ.update({
    "IS_LOCAL": "true",
    "POSTGRES_HOST": os.getenv("TEST_POSTGRES_HOST", "localhost"),
    "POSTGRES_PORT": "5432",
    "POSTGRES_USER": "postgres",
    "POSTGRES_PASS": os.getenv("TEST_POSTGRES_PASS", "postgres123"),
    "POSTGRES_NAME": TEST_DB,
})
sys.path.insert(0, str(BACKEND_DIR / "_shared"))

import psycopg  # noqa: E402

from pm_core import config, db  # noqa: E402


def _admin_conninfo() -> str:
    """Connection string for the default ``postgres`` database."""
    return config.postgres_conninfo().replace(f"dbname={TEST_DB}", "dbname=postgres")


@pytest.fixture(scope="session")
def test_database() -> str:
    """Create the test database once per session if it does not exist."""
    with psycopg.connect(_admin_conninfo(), autocommit=True) as conn:
        exists = conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (TEST_DB,)).fetchone()
        if not exists:
            conn.execute(f'CREATE DATABASE "{TEST_DB}"')
    return TEST_DB


@pytest.fixture
def fresh_db(test_database: str):
    """Reset the test database to an empty, freshly migrated and seeded state."""
    db.reset()
    with psycopg.connect(config.postgres_conninfo(), autocommit=True) as conn:
        conn.execute("DROP SCHEMA public CASCADE")
        conn.execute("CREATE SCHEMA public")
    db.get_connection()
    yield
    db.reset()


def load_service(name: str) -> ModuleType:
    """Import ``backend/<name>/function.py`` as a uniquely named module."""
    path = BACKEND_DIR / name / "function.py"
    spec = importlib.util.spec_from_file_location(f"service_{name}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def make_event(
    method: str,
    path: str,
    body: object = None,
    headers: dict | None = None,
    query: dict | None = None,
) -> dict:
    """Build a Lambda Function URL (payload v2) event."""
    return {
        "rawPath": path,
        "requestContext": {"http": {"method": method}},
        "headers": headers or {},
        "queryStringParameters": query,
        "body": json.dumps(body) if body is not None and not isinstance(body, str) else body,
        "isBase64Encoded": False,
    }


def response_json(response: dict) -> object:
    """Decode the JSON body of a Lambda response."""
    return json.loads(response["body"]) if response.get("body") else None
