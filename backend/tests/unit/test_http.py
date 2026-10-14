"""Unit tests for the pm_core.http router (no database)."""

import base64
from datetime import date
from decimal import Decimal

import psycopg
import pytest

from conftest import make_event, response_json
from pm_core.errors import NotFound
from pm_core.http import Request, Response, Router, created, no_content, ok

router = Router("widgets")


@router.get("/")
def list_widgets(request: Request) -> Response:
    return ok({"items": [], "query": request.query})


@router.post("/")
def create_widget(request: Request) -> Response:
    return created({"received": request.body})


@router.get("/{id}")
def get_widget(request: Request) -> Response:
    if request.params["id"] == "404":
        raise NotFound("Widget not found")
    return ok({"id": request.params["id"], "price": Decimal("9.50"), "due": date(2026, 1, 2)})


@router.delete("/{id}")
def delete_widget(request: Request) -> Response:
    return no_content()


@router.patch("/{id}")
def update_widget(request: Request) -> Response:
    return ok({"updated": request.params["id"], "with": request.body})


@router.post("/{id}/explode")
def explode(request: Request) -> Response:
    raise RuntimeError("secret internal detail")


@router.post("/{id}/duplicate")
def duplicate(request: Request) -> Response:
    raise psycopg.errors.UniqueViolation("duplicate key")


def call(method: str, path: str, **kwargs: object) -> dict:
    """Invoke the test router with a synthetic event."""
    return router.handle(make_event(method, path, **kwargs))


@pytest.mark.parametrize("path", ["/", "/api/widgets", "/api/widgets/"])
def test_root_route_with_and_without_cloudfront_prefix(path: str) -> None:
    response = call("GET", path, query={"q": "x"})
    assert response["statusCode"] == 200
    assert response_json(response) == {"items": [], "query": {"q": "x"}}


@pytest.mark.parametrize("path", ["/7", "/api/widgets/7", "/7/"])
def test_path_params_and_json_serialisation(path: str) -> None:
    response = call("GET", path)
    assert response_json(response) == {"id": "7", "price": 9.5, "due": "2026-01-02"}
    assert response["headers"]["Content-Type"] == "application/json"


def test_post_returns_201_with_parsed_body() -> None:
    response = call("POST", "/", body={"name": "w"})
    assert response["statusCode"] == 201
    assert response_json(response) == {"received": {"name": "w"}}


def test_base64_body_is_decoded() -> None:
    event = make_event("POST", "/")
    event["body"] = base64.b64encode(b'{"a": 1}').decode()
    event["isBase64Encoded"] = True
    assert response_json(router.handle(event)) == {"received": {"a": 1}}


def test_delete_returns_204_without_body() -> None:
    response = call("DELETE", "/7")
    assert response["statusCode"] == 204
    assert "body" not in response


def test_invalid_json_returns_400() -> None:
    response = call("POST", "/", body="{not json")
    assert response["statusCode"] == 400
    assert response_json(response)["error"]["code"] == "bad_request"


def test_api_error_uses_consistent_shape() -> None:
    response = call("GET", "/404")
    assert response["statusCode"] == 404
    assert response_json(response) == {"error": {"code": "not_found", "message": "Widget not found"}}


def test_unknown_route_returns_404() -> None:
    response = call("GET", "/7/unknown")
    assert response["statusCode"] == 404


def test_wrong_method_returns_405() -> None:
    response = call("POST", "/7")
    assert response["statusCode"] == 405


@pytest.mark.parametrize("method", ["PATCH", "PUT"])
def test_updates_accept_patch_and_put(method: str) -> None:
    response = call(method, "/7", body={"name": "w"})
    assert response_json(response) == {"updated": "7", "with": {"name": "w"}}


def test_options_preflight_returns_204() -> None:
    assert call("OPTIONS", "/7")["statusCode"] == 204


def test_unhandled_error_hides_details_and_returns_request_id() -> None:
    response = call("POST", "/7/explode")
    body = response_json(response)
    assert response["statusCode"] == 500
    assert "secret" not in response["body"]
    assert body["error"]["code"] == "internal_error"
    assert body["error"]["details"]["request_id"]


def test_unique_violation_maps_to_409() -> None:
    response = call("POST", "/7/duplicate")
    assert response["statusCode"] == 409
    assert response_json(response)["error"]["code"] == "conflict"


def test_missing_event_defaults_to_get_root() -> None:
    assert router.handle(None)["statusCode"] == 200
