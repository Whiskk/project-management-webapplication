"""
Password generation and hashing.

Uses only the standard library (PBKDF2-HMAC-SHA256) so there are no compiled
dependencies to package for Lambda. The iteration count is stored inside each
hash so it can be raised later without invalidating existing passwords.
"""

import base64
import hashlib
import hmac
import secrets
import string

# Lambdas run with 128 MB (a small CPU share), so this is tuned to keep login
# well under a second while still being expensive to brute-force offline.
_ITERATIONS = 120_000
_ALGORITHM = "pbkdf2_sha256"
_ALPHABET = string.ascii_letters + string.digits
PASSWORD_LENGTH = 6


def generate_password(length: int = PASSWORD_LENGTH) -> str:
    """Return a cryptographically random alphanumeric password."""
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))


def hash_password(password: str, iterations: int = _ITERATIONS) -> str:
    """Hash a password as ``pbkdf2_sha256$<iterations>$<salt>$<hash>``."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return "$".join([
        _ALGORITHM,
        str(iterations),
        base64.b64encode(salt).decode(),
        base64.b64encode(digest).decode(),
    ])


def verify_password(password: str, stored: str) -> bool:
    """Return True if ``password`` matches the stored hash (constant-time compare)."""
    try:
        algorithm, iterations, salt_b64, digest_b64 = stored.split("$")
        if algorithm != _ALGORITHM:
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(digest_b64)
    except (ValueError, TypeError):
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, int(iterations))
    return hmac.compare_digest(actual, expected)
