-- Login-to-user resolution for the BE API Lambda.
--
-- The Lambda knows only the verified token subject. Before it can bind a request
-- identity it must map that subject to an application user through the approved
-- mapping in users.identity_subject. RLS on users only shows a caller their own row
-- once their identity is bound, so the lookup runs as a narrow SECURITY DEFINER
-- function. It returns a user only for a 'matched' mapping: unresolved or conflicting
-- logins get no user and therefore no data (requirements rule 9).

CREATE OR REPLACE FUNCTION app.resolve_user_id(subject text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT u.user_id FROM users u
  WHERE u.identity_subject = subject AND u.identity_status = 'matched'
$$;

REVOKE ALL ON FUNCTION app.resolve_user_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_user_id(text) TO app_user;

-- Permission checks the API uses to choose a path (record-level vs aggregate-only).
GRANT EXECUTE ON FUNCTION app.has_permission(text), app.request_user_id() TO app_user;
