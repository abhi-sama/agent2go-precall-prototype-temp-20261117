"use client"

import { fetchAuthSession } from "aws-amplify/auth"
import { LogIn } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import * as React from "react"
import { Banner } from "@astryxdesign/core/Banner"
import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { Text } from "@astryxdesign/core/Text"
import { TextInput } from "@astryxdesign/core/TextInput"
import { VStack } from "@astryxdesign/core/VStack"
import { BrandMark } from "@/components/brand/brand-mark"
import { AppearanceSettings } from "@/components/shell/appearance-settings"
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
    <VStack gap={6} width="100%" maxWidth={448}>
      <HStack gap={3} vAlign="center">
        <BrandMark className="size-11" priority />
        <VStack gap={0.5}>
          <Heading level={1} textWrap="balance">
            Sign in to MSL Agent
          </Heading>
          <Text type="supporting">Use your organisation account.</Text>
        </VStack>
      </HStack>

      <Card padding={5} elevation="low">
        {/* MWG autofill-sign-in-form: stable ids and names, username + current-password autocomplete, a real submit button. */}
        <form
          method="post"
          onSubmit={(e) => {
            e.preventDefault()
            // The fields are aria-required rather than natively required, so empty input is caught here.
            if (!email.trim() || !password) {
              setError("Enter your email and password.")
              return
            }
            void attempt("form", email.trim(), password)
          }}
        >
          <VStack gap={4}>
            <TextInput
              id="email"
              htmlName="email"
              label="Email"
              type="email"
              autoComplete="username"
              autoCapitalize="none"
              inputMode="email"
              isRequired
              size="lg"
              width="100%"
              value={email}
              onChange={(value) => setEmail(value)}
              data-testid="login-email"
            />
            <TextInput
              id="password"
              htmlName="password"
              label="Password"
              type="password"
              autoComplete="current-password"
              isRequired
              size="lg"
              width="100%"
              value={password}
              onChange={(value) => setPassword(value)}
              data-testid="login-password"
            />
            {error && (
              <Banner
                status="error"
                title="Sign-in failed"
                collapsible={false}
                description={
                  <Text role="alert" data-testid="login-error">
                    {error}
                  </Text>
                }
              />
            )}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              width="100%"
              icon={<Icon icon={LogIn} />}
              label={busy === "form" ? "Signing in…" : "Sign in"}
              isLoading={busy === "form"}
              isDisabled={busy !== null && busy !== "form"}
              data-testid="login-submit"
            />
          </VStack>
        </form>
      </Card>

      {/* Inline env comparison (not IS_LOCAL_BUILD): the bundler only drops code for a literal it can fold here. */}
      {process.env.NEXT_PUBLIC_APP_ENV === "local" ? <SeededLogins busy={busy} onPick={(id, email, pass) => void attempt(id, email, pass)} /> : null}
    </VStack>
  )
}

export default function LoginPage() {
  return (
    <VStack className="safe-px safe-pt safe-pb min-h-dvh bg-background">
      {/* The look can be chosen before signing in; it is remembered on this device (MWG dark-mode-toggle: a settings surface). */}
      <HStack as="header" justify="end" paddingBlock={3}>
        <AppearanceSettings />
      </HStack>
      <HStack as="main" id="main" justify="center" paddingBlockStart={4} paddingBlockEnd={10} className="flex-1 items-start sm:items-center">
        <React.Suspense fallback={null}>
          <LoginForm />
        </React.Suspense>
      </HStack>
    </VStack>
  )
}
