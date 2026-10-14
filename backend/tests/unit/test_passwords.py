"""Unit tests for pm_core.passwords."""

import string

from pm_core import passwords


def test_generated_password_is_six_alphanumeric_characters() -> None:
    allowed = set(string.ascii_letters + string.digits)
    for _ in range(50):
        password = passwords.generate_password()
        assert len(password) == 6
        assert set(password) <= allowed


def test_generated_passwords_are_not_repeated() -> None:
    assert len({passwords.generate_password() for _ in range(200)}) > 195


def test_hash_and_verify_round_trip() -> None:
    stored = passwords.hash_password("Abc123", iterations=1000)
    assert stored.startswith("pbkdf2_sha256$1000$")
    assert passwords.verify_password("Abc123", stored)
    assert not passwords.verify_password("abc123", stored)


def test_same_password_gets_different_salts() -> None:
    assert passwords.hash_password("Abc123", 1000) != passwords.hash_password("Abc123", 1000)


def test_verify_rejects_malformed_hashes() -> None:
    assert not passwords.verify_password("x", "garbage")
    assert not passwords.verify_password("x", "md5$1$abc$def")
    assert not passwords.verify_password("x", "pbkdf2_sha256$1000$!!!$???")
