# Identity is a verified Cognito ID token, and its claims win

The browser sends the Cognito **ID** token, plus the IdP-provided full name and email (`x-user-full-name`, `x-user-email`) and an `x-correlation-id`.
The BE Lambda verifies the token itself, independently of AppSync: RS256 signature against the user-pool JWKS, issuer, audience (app client), expiry, and `token_use = id`.
Token claims always win over the request fields.
Persona comes from exactly one Cognito group (`MSL`, `Director`, `Executive`, `Administrator`); zero or several is `Forbidden`.
The token subject maps to an application user only through the approved mapping `users.identity_subject = 'cognito|<sub>'`, read by `app.resolve_user_id`.
Only `matched` identities resolve.
Territory scope never comes from the token.

The ID token, not the access token, is used because it carries the name and email that the claims-win rule compares.
Mapping by email or name was rejected: requirements rule 9 forbids combining records on similar names or emails without an approved mapping.
Okta later federates into Cognito for authentication only, and its name and email land on the same standard claims.

## Local stand-in (floci)

floci's AppSync passes `ctx.request.headers` to resolvers as an empty map (hard-coded in its executor), so locally the raw token and the request name/email never reach the Lambda.
With `A2G_ENV=local` and `A2G_TRUST_APPSYNC_IDENTITY=1`, the Lambda accepts the claims AppSync forwarded, which floci's AppSync has already signature-verified, and still checks issuer, audience, expiry and token_use.
The setting refuses to load in any other environment.
The Lambda's own verification is proven locally by invoking it directly with the headers AWS AppSync would forward (`tests/api/test_identity.py`).
The same limitation means correlation ids do not cross AppSync locally; the Lambda mints its own.
