"""Errors surfaced to AppSync.

The Lambda runtime reports an unhandled exception's class name as ``errorType``, and
the AppSync resolver forwards it with ``util.error``. The frontend classifies on that
type, so class names are part of the API. Messages are fixed strings and never carry
request data.
"""


class ApiError(Exception):
    code = "UNAVAILABLE"
    public_message = "The data service is unavailable."

    def __init__(self, reason: str = "") -> None:
        # ``reason`` is for logs (an enum-like token), never for the response.
        super().__init__(self.public_message)
        self.reason = reason


class Unauthorized(ApiError):
    code = "UNAUTHENTICATED"
    public_message = "Unauthorized: the sign-in token is missing, invalid, or expired."


class Forbidden(ApiError):
    code = "FORBIDDEN"
    public_message = "Forbidden: this account has no access to the requested data."


class NoScope(ApiError):
    code = "NO_SCOPE"
    public_message = "NoScope: no territory is assigned to this account."


class BadRequest(ApiError):
    code = "BAD_REQUEST"
    public_message = "BadRequest: the request arguments are invalid."


class Unavailable(ApiError):
    code = "UNAVAILABLE"
    public_message = "Unavailable: the data service is unavailable."
