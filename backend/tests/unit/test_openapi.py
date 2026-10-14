"""
Keeps docs/api/openapi.yaml honest: every route the services register is
documented, nothing documented is missing from the code, and every $ref
resolves. Adding or removing a route without updating the spec fails here.
"""

import re

import pytest
import yaml

from conftest import BACKEND_DIR, load_service

SPEC_PATH = BACKEND_DIR.parent / "docs" / "api" / "openapi.yaml"
SERVICES = ("auth", "users", "projects", "audit", "monitor", "health")
HTTP_METHODS = {"get", "post", "put", "patch", "delete"}
_PARAM_GROUP = re.compile(r"\(\?P<(\w+)>\[\^/\]\+\)")


@pytest.fixture(scope="module")
def spec() -> dict:
    return yaml.safe_load(SPEC_PATH.read_text())


def _code_routes() -> set[tuple[str, str]]:
    """``(METHOD, /api/<service>/path)`` for every route registered by the services."""
    routes = set()
    for name in SERVICES:
        router = load_service(name).router
        for method, regex, _ in router._routes:
            # "^/(?P<id>[^/]+)/archive/?$" -> "/{id}/archive"
            path = _PARAM_GROUP.sub(r"{\1}", regex.pattern)[1:].removesuffix("/?$")
            routes.add((method, f"/api/{name}{path}"))
    return routes


def _spec_routes(spec: dict) -> set[tuple[str, str]]:
    return {(method.upper(), path) for path, item in spec["paths"].items() for method in item if method in HTTP_METHODS}


def test_every_route_is_documented_and_every_documented_route_exists(spec):
    code, documented = _code_routes(), _spec_routes(spec)
    assert sorted(code - documented) == [], "routes missing from docs/api/openapi.yaml"
    assert sorted(documented - code) == [], "documented routes that the services do not register"


def test_every_ref_resolves(spec):
    text = SPEC_PATH.read_text()
    for ref in set(re.findall(r'\$ref: "#/([^"]+)"', text)):
        node = spec
        for part in ref.split("/"):
            assert part in node, f"unresolved $ref #/{ref}"
            node = node[part]


def test_operations_have_unique_ids_and_document_their_errors(spec):
    ids = []
    for path, item in spec["paths"].items():
        for method, operation in item.items():
            if method not in HTTP_METHODS:
                continue
            ids.append(operation["operationId"])
            assert operation.get("tags"), f"{method.upper()} {path} has no tag"
            if operation.get("security") != []:
                assert "401" in operation["responses"], f"{method.upper()} {path} does not document 401"
    assert len(ids) == len(set(ids)), "duplicate operationId"


def test_path_parameters_are_declared(spec):
    for path, item in spec["paths"].items():
        declared = {p["name"] for p in item.get("parameters", []) if "name" in p}
        declared |= {
            spec["components"]["parameters"][p["$ref"].rsplit("/", 1)[1]]["name"]
            for p in item.get("parameters", [])
            if "$ref" in p
        }
        assert set(re.findall(r"{(\w+)}", path)) <= declared, f"{path} has undeclared path parameters"
