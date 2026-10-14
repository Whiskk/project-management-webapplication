"""Unit and migration tests for the initials-based employee ID format."""

import pytest

from pm_core import db, identity, passwords, schema
from pm_core.identity import EMPLOYEE_ID_PATTERN, ID_ALPHABET


@pytest.mark.parametrize(
    ("first", "last", "expected"),
    [("Eli", "Employee", "EE"), ("ólafur", "Ásgeirsson", "OA"), ("Mary-Jane", "o'Neil", "MO"), ("", "123", "XX")],
)
def test_initials(first: str, last: str, expected: str) -> None:
    assert identity.initials(first, last) == expected


def test_alphabet_has_no_look_alike_characters() -> None:
    assert not set("0O1IL") & set(ID_ALPHABET)
    assert len(ID_ALPHABET) == 31


def test_random_suffixes_use_the_alphabet_and_vary() -> None:
    suffixes = {identity.random_suffix() for _ in range(300)}
    assert all(len(s) == 4 and set(s) <= set(ID_ALPHABET) for s in suffixes)
    assert len(suffixes) > 290


def test_demo_accounts_follow_the_format() -> None:
    for user in schema.DEMO_USERS:
        assert EMPLOYEE_ID_PATTERN.match(user["employee_id"])
        assert user["employee_id"][:2] == identity.initials(user["first_name"], user["last_name"])


@pytest.mark.db
def test_generation_retries_on_collision(fresh_db: None, monkeypatch: pytest.MonkeyPatch) -> None:
    suffixes = iter(["7K2P", "9ZZZ"])  # AA7K2P is the demo admin, so the first draw clashes
    monkeypatch.setattr(identity, "random_suffix", lambda: next(suffixes))
    with db.transaction() as cur:
        assert identity.generate_employee_id(cur, "Ann", "Able") == "AA9ZZZ"


@pytest.mark.db
def test_migration_converts_old_style_ids_and_audits_it(fresh_db: None) -> None:
    with db.transaction() as cur:
        # Recreate a pre-migration database: old-style IDs, migration 5 not yet applied.
        cur.execute("UPDATE users SET employee_id = 'ADM001' WHERE employee_id = 'AA7K2P'")
        cur.execute("UPDATE users SET employee_id = 'MGR001' WHERE employee_id = 'MM4R8T'")
        cur.execute(
            "INSERT INTO users (employee_id, first_name, last_name, email, role, password_hash) "
            "VALUES ('MGR002', 'Pat', 'Other', 'pat@example.com', 'manager', %s)",
            (passwords.hash_password("Pat123", 1000),),
        )
        # Rewind to just before migration 5 (later migrations are re-applied too).
        cur.execute("DROP TABLE tasks")  # migration 7
        cur.execute("ALTER TABLE users DROP COLUMN must_change_password")  # migration 6
        cur.execute("DELETE FROM schema_version WHERE version >= 5")
    db.reset()
    db.get_connection()  # re-runs pending migrations

    with db.transaction() as cur:
        cur.execute("SELECT employee_id, first_name FROM users ORDER BY id")
        ids = {r["first_name"]: r["employee_id"] for r in cur.fetchall()}
        cur.execute("SELECT summary, actor_employee_id FROM audit_log WHERE action = 'user.employee_id_changed'")
        entries = cur.fetchall()
    assert (ids["Alex"], ids["Morgan"], ids["Eli"]) == ("AA7K2P", "MM4R8T", "EE3H9W")
    assert EMPLOYEE_ID_PATTERN.match(ids["Pat"]) and ids["Pat"].startswith("PO")
    assert len(entries) == 3
    assert {e["actor_employee_id"] for e in entries} == {"SYSTEM"}
    assert any("from MGR002 to PO" in e["summary"] for e in entries)
