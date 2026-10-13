"""
Environment configuration injected by Terraform into every Lambda.
"""

import os


def is_local() -> bool:
    """Return True when running against LocalStack / local Postgres."""
    return os.getenv("IS_LOCAL", "false") == "true"


def postgres_conninfo() -> str:
    """
    Build a libpq connection string from the injected environment variables.

    AWS Aurora requires TLS, so ``sslmode=require`` is added when not local.
    """
    parts = [
        f"host={os.getenv('POSTGRES_HOST', 'localhost')}",
        f"port={os.getenv('POSTGRES_PORT', '5432')}",
        f"user={os.getenv('POSTGRES_USER', 'postgres')}",
        f"password={os.getenv('POSTGRES_PASS', 'postgres123')}",
        f"dbname={os.getenv('POSTGRES_NAME', 'postgres')}",
        "connect_timeout=15",
    ]
    if not is_local():
        parts.append("sslmode=require")
    return " ".join(parts)
