"use client"

import { fetchAuthSession } from "aws-amplify/auth"
import { LogIn, Stethoscope } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PERSONA_HOME } from "@/lib/data/fixtures"
import type { Persona } from "@/lib/data/types"
import { DATA_ADAPTER } from "@/lib/env"
import { signInWithPassword } from "@/lib/session/cognito-session"
import { SeededLogins } from "@/components/shell/seeded-logins"
import { useSession } from "@/lib/session/session-provider"
import { safeNext } from "@/lib/session/safe-next"

const GROUP_PERSONA: Record<string, Persona> = { MSL: "msl", Director: "director", Executive: "executive", Administrator: "admin" }

const ERRORS: Record<string, string> = {
  NotAuthorizedException: "Email or password is incorrect.",
  UserNotFoundException: "Email or password is incorrect.",
  next_step_required: "This account needs an extra sign-in step that the local stack does not support.",
  not_configured: "Sign-in is not configured. Run backend/infra/scripts/up.sh first.",
}

/** Where to go after sign-in: the requested same-origin page, or the persona's home. */
async function destination(next: string | null): Promise<string> {
  const target = safeNext(next, window.location.origin)
  if (target) return target
  const groups = (await fetchAuthSession()).tokens?.idToken?.payload["cognito:groups"]
  const persona = Array.isArray(groups) ? groups.map((g) => GROUP_PERSONA[String(g)]).find(Boolean) : undefined
  return persona ? PERSONA_HOME[persona] : "/msl"
}

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const { refresh } = useSession()
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (DATA_ADAPTER !== "appsync") router.replace("/msl")
  }, [router])

  async function attempt(id: string, user: string, pass: string) {
    setBusy(id)
    setError(null)
    const failure = await signInWithPassword(user, pass)
    if (failure) {
      setError(ERRORS[failure] ?? "Sign-in failed. Try again.")
      setBusy(null)
      return
    }
    // Let the session see the new identity before leaving, or the signed-out guard bounces back here.
    await refresh()
    router.replace(await destination(params.get("next")))
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-6">
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground shadow-lift">
          <Stethoscope className="size-6" aria-hidden />
        </span>
        <div className="flex flex-col leading-tight">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to MSL Agent</h1>
          <p className="text-sm text-muted-foreground">Use your organisation account.</p>
        </div>
      </div>

      <form
        className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault()
          void attempt("form", email.trim(), password)
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11"
            data-testid="login-email"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11"
            data-testid="login-password"
          />
        </div>
        {error && (
          <p role="alert" data-testid="login-error" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={busy !== null} data-testid="login-submit">
          <LogIn aria-hidden />
          {busy === "form" ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      {/* Inline env comparison (not IS_LOCAL_BUILD): the bundler only drops code for a literal it can fold here. */}
      {process.env.NEXT_PUBLIC_APP_ENV === "local" ? <SeededLogins busy={busy} onPick={(id, email, pass) => void attempt(id, email, pass)} /> : null}
    </div>
  )
}

export default function LoginPage() {
  return (
    <main id="main" className="safe-px safe-pt safe-pb flex min-h-dvh items-start justify-center bg-background py-10 sm:items-center">
      <React.Suspense fallback={null}>
        <LoginForm />
      </React.Suspense>
    </main>
  )
}
