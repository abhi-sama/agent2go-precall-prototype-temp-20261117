// AppSync JS resolver shared by every BE-backed field.
// Forwards the field, arguments, AppSync-verified identity, and request headers
// (raw token, IdP name/email, correlation id) to the cross-account BE Lambda.
// The BE re-verifies the token and lets token claims win over request fields.
import { util } from '@aws-appsync/utils';

export function request(ctx) {
  return {
    operation: 'Invoke',
    payload: {
      fieldName: ctx.info.fieldName,
      arguments: ctx.arguments,
      identity: ctx.identity,
      request: { headers: ctx.request.headers },
    },
  };
}

export function response(ctx) {
  if (ctx.error) {
    // Unhandled BE failure: never echo its message, it may carry data.
    util.error('Unavailable: the data service is unavailable.', 'Unavailable');
  }
  const refusal = ctx.result && ctx.result.__a2gError;
  if (refusal) {
    // Typed refusal from the BE (Unauthorized, Forbidden, NoScope, BadRequest).
    util.error(refusal.message, refusal.type);
  }
  return ctx.result;
}
