"""
Employee ID generation.

Format: the first letter of the first name, the first letter of the last
name, then 4 random characters - e.g. Eli Employee -> ``EE3H9W``.

The random part uses uppercase letters and digits without look-alikes
(0/O, 1/I/L), so IDs are easy to read out and type. IDs never change after
creation (renaming someone keeps their login stable).
"""

import re
import secrets
import unicodedata

import psycopg

# 31 characters: A-Z and 2-9 without O, I, L, 0, 1.
ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
RANDOM_LENGTH = 4
EMPLOYEE_ID_PATTERN = re.compile(rf"^[A-Z]{{2}}[{ID_ALPHABET}]{{{RANDOM_LENGTH}}}$")
_MAX_ATTEMPTS = 50


def initial(name: str) -> str:
    """First letter of a name as plain uppercase ASCII (Ólafur -> O); 'X' if it has none."""
    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    letters = [ch for ch in plain if ch.isalpha()]
    return letters[0].upper() if letters else "X"


def initials(first_name: str, last_name: str) -> str:
    """The two-letter prefix of an employee ID."""
    return initial(first_name) + initial(last_name)


def random_suffix() -> str:
    """4 cryptographically random characters from the readable alphabet."""
    return "".join(secrets.choice(ID_ALPHABET) for _ in range(RANDOM_LENGTH))


def generate_employee_id(cur: psycopg.Cursor, first_name: str, last_name: str) -> str:
    """
    Return a new, unused employee ID for this person.

    With ~923,000 suffixes per pair of initials a clash is very unlikely; on a
    clash another suffix is drawn. The unique constraint on ``users.employee_id``
    remains the final guarantee if two requests race.
    """
    prefix = initials(first_name, last_name)
    for _ in range(_MAX_ATTEMPTS):
        candidate = prefix + random_suffix()
        cur.execute("SELECT 1 FROM users WHERE upper(employee_id) = %s", (candidate,))
        if cur.fetchone() is None:
            return candidate
    raise RuntimeError(f"Could not find a free employee ID for initials {prefix}")
