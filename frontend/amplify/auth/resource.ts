import { defineAuth } from '@aws-amplify/backend';

/** Web origins allowed as OAuth redirect targets (comma-separated). */
const webOrigins = (process.env.A2G_WEB_ORIGINS ?? 'http://localhost:3210')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

/**
 * Cognito user pool for the FE account.
 *
 * Persona = Cognito group (exactly one per user). Territory scope never lives here:
 * the BE resolves it from effective-dated entitlement tables in Postgres.
 * Okta federation is added later as an OIDC external provider (authentication only),
 * with its name/email mapped onto the standard `name`/`email` attributes.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
    externalProviders: {
      callbackUrls: webOrigins.map((origin) => `${origin}/auth/callback`),
      logoutUrls: webOrigins.map((origin) => `${origin}/login`),
    },
  },
  groups: ['MSL', 'Director', 'Executive', 'Administrator'],
  userAttributes: {
    fullname: { required: false, mutable: true },
  },
});
