"""
PostgreSQL connection management.

One connection per thread is reused across Lambda invocations in the same
container (cheap "pooling"; a Lambda container handles one request at a
time, so in practice that is a single connection). On first use the schema
migrations are applied, so a fresh database - local or AWS Aurora - is ready
without any manual setup step.
"""

import logging
import threading
from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row

from pm_core import config, schema

logger = logging.getLogger(__name__)

_local = threading.local()
_schema_ready = False


def get_connection() -> psycopg.Connection:
    """Return this thread's live connection, (re)connecting and migrating as needed."""
    global _schema_ready
    conn: psycopg.Connection | None = getattr(_local, "conn", None)
    if conn is None or conn.closed or conn.broken:
        conn = psycopg.connect(config.postgres_conninfo(), autocommit=True, row_factory=dict_row)
        _local.conn = conn
    if not _schema_ready:
        schema.ensure_schema(conn)
        _schema_ready = True
    return conn


def reset() -> None:
    """Drop this thread's cached connection and the schema flag (after failures and in tests)."""
    global _schema_ready
    conn: psycopg.Connection | None = getattr(_local, "conn", None)
    if conn is not None and not conn.closed:
        conn.close()
    _local.conn = None
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

    A lock timeout guarantees this can never wait forever on a row lock held by
    the request's own (still open) transaction - Postgres cannot detect that
    kind of deadlock because the other side of the wait is in Python.
    """
    get_connection()  # ensure the schema exists
    with (
        psycopg.connect(config.postgres_conninfo(), autocommit=True, row_factory=dict_row) as conn,
        conn.transaction(),
        conn.cursor() as cur,
    ):
        cur.execute("SET LOCAL lock_timeout = '5s'")
        yield cur
