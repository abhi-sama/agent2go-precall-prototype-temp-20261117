import { Amplify } from "aws-amplify"
import { parseAmplifyConfig } from "aws-amplify/utils"

/**
 * Amplify Gen2 outputs, inlined at build time from `NEXT_PUBLIC_AMPLIFY_OUTPUTS`.
 * Locally `backend/infra/scripts/up.sh` writes it into `.env.local` (the same content as
 * `amplify_outputs.json`); deployed builds get it from the Amplify Hosting pipeline.
 */
export interface SeededUser {
  userId: string
  email: string
  fullName: string
  persona: string
  territoryId: string
  identityStatus: string | null
}

interface A2gCustom {
  env?: string
  /** Same-origin prefix the Next dev/prod server rewrites to floci (local only). */
  proxy_path?: string
  local_password?: string
  seeded_users?: SeededUser[]
}

export interface AmplifyOutputs {
  auth: { user_pool_id: string; user_pool_client_id: string; aws_region: string }
  data: { url: string; aws_region: string }
  custom?: { a2g?: A2gCustom }
}

function readOutputs(): AmplifyOutputs | null {
  const raw = process.env.NEXT_PUBLIC_AMPLIFY_OUTPUTS
  if (!raw) return null
  try {
    return JSON.parse(raw) as AmplifyOutputs
  } catch {
    return null
  }
}

export const AMPLIFY_OUTPUTS = readOutputs()
const A2G = AMPLIFY_OUTPUTS?.custom?.a2g

/** True when the backend is the local floci stack (endpoints go through the same-origin proxy). */
export const IS_FLOCI = A2G?.env === "local"

/** floci answers no CORS preflights, so the browser reaches it through a same-origin rewrite. */
function viaProxy(url: string): string {
  if (!IS_FLOCI || typeof window === "undefined") return url
  const u = new URL(url)
  return `${window.location.origin}${A2G?.proxy_path ?? "/_floci"}${u.pathname}${u.search}`
}

export function graphqlUrl(): string {
  if (!AMPLIFY_OUTPUTS) throw new Error("NEXT_PUBLIC_AMPLIFY_OUTPUTS is not set; run backend/infra/scripts/up.sh")
  return viaProxy(AMPLIFY_OUTPUTS.data.url)
}

/** Local-only quick-switch data. Empty outside the local floci stack. */
export function localSeededUsers(): { users: SeededUser[]; password: string | null } {
  if (!IS_FLOCI) return { users: [], password: null }
  return { users: A2G?.seeded_users ?? [], password: A2G?.local_password ?? null }
}

let configured = false

export function configureAmplify(): boolean {
  if (configured) return true
  if (!AMPLIFY_OUTPUTS || typeof window === "undefined") return false
  const config = parseAmplifyConfig(AMPLIFY_OUTPUTS as unknown as Parameters<typeof parseAmplifyConfig>[0])
  if (IS_FLOCI && config.Auth?.Cognito) {
    // Cognito's JSON API is served at floci's root; route it through the same-origin proxy.
    config.Auth.Cognito.userPoolEndpoint = `${window.location.origin}${A2G?.proxy_path ?? "/_floci"}`
  }
  Amplify.configure(config)
  configured = true
  return true
}
