"""
PostgreSQL connection management.

A single module-level connection is reused across Lambda invocations in the
same container (cheap "pooling"). On first use the schema migrations are
applied, so a fresh database - local or AWS Aurora - is ready without any
manual setup step.
"""

import logging
from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row

from pm_core import config, schema

logger = logging.getLogger(__name__)

_conn: psycopg.Connection | None = None
_schema_ready = False


def get_connection() -> psycopg.Connection:
    """Return a live connection, (re)connecting and migrating as needed."""
    global _conn, _schema_ready
    if _conn is None or _conn.closed or _conn.broken:
        _conn = psycopg.connect(config.postgres_conninfo(), autocommit=True, row_factory=dict_row)
    if not _schema_ready:
        schema.ensure_schema(_conn)
        _schema_ready = True
    return _conn


def reset() -> None:
    """Drop the cached connection and schema flag (used after failures and in tests)."""
    global _conn, _schema_ready
    if _conn is not None and not _conn.closed:
        _conn.close()
    _conn = None
    _schema_ready = False


@contextmanager
def transaction() -> Iterator[psycopg.Cursor]:
    """
    Yield a dict-row cursor inside a single database transaction.

    Everything executed with the cursor commits together or rolls back
    together - which is what lets audit entries be written atomically with
    the change they describe.
    """
    try:
        conn = get_connection()
        with conn.transaction(), conn.cursor() as cur:
            yield cur
    except psycopg.OperationalError:
        logger.exception("Database connection error - resetting connection")
        reset()
        raise


@contextmanager
def independent_transaction() -> Iterator[psycopg.Cursor]:
    """
    Yield a cursor on a separate, short-lived connection.

    Used for writes that must commit even when the surrounding request's
    transaction rolls back (e.g. auditing a denied attempt mid-transaction).
    """
    get_connection()  # ensure the schema exists
    with (
        psycopg.connect(config.postgres_conninfo(), autocommit=True, row_factory=dict_row) as conn,
        conn.transaction(),
        conn.cursor() as cur,
    ):
        yield cur
