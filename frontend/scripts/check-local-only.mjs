#!/usr/bin/env node
/**
 * Proves the persona quick-switch and seeded-user data exist only in local builds.
 *
 * Builds the app as a deployed build would (NEXT_PUBLIC_APP_ENV=production, AppSync adapter,
 * Amplify outputs without the local `custom.a2g` block) into a separate dist dir, then scans
 * every emitted client file for the quick-switch UI, the seeded identities and the local password.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const dist = ".next-deployed-check"
const outputsPath = path.join(root, "amplify_outputs.json")
const local = existsSync(outputsPath) ? JSON.parse(readFileSync(outputsPath, "utf8")) : null
const deployed = local
  ? { ...local, custom: undefined }
  : { version: "1.3", auth: { aws_region: "us-east-1", user_pool_id: "us-east-1_x", user_pool_client_id: "x" }, data: { url: "https://example.invalid/graphql", aws_region: "us-east-1" } }

rmSync(path.join(root, dist), { recursive: true, force: true })
execFileSync("pnpm", ["exec", "next", "build"], {
  cwd: root,
  stdio: ["ignore", "ignore", "inherit"],
  env: {
    ...process.env,
    NEXT_DIST_DIR: dist,
    NEXT_PUBLIC_APP_ENV: "production",
    NEXT_PUBLIC_DATA_ADAPTER: "appsync",
    NEXT_PUBLIC_AMPLIFY_OUTPUTS: JSON.stringify(deployed),
  },
})

const forbidden = [
  "persona-switch",
  "persona-option-",
  "seeded-login",
  "Local build only",
  ...(local ? [local.custom.a2g.local_password, ...local.custom.a2g.seeded_users.map((u) => u.email)] : []),
]

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) yield* files(p)
    else if (/\.(js|html|json|rsc|txt)$/.test(name)) yield p
  }
}

const hits = []
for (const file of files(path.join(root, dist, "static"))) {
  const text = readFileSync(file, "utf8")
  for (const needle of forbidden) if (text.includes(needle)) hits.push(`${path.relative(root, file)}: ${needle.slice(0, 24)}`)
}
for (const file of files(path.join(root, dist, "server", "app"))) {
  if (!/\.(html|rsc)$/.test(file)) continue
  const text = readFileSync(file, "utf8")
  for (const needle of forbidden) if (text.includes(needle)) hits.push(`${path.relative(root, file)}: ${needle.slice(0, 24)}`)
}
rmSync(path.join(root, dist), { recursive: true, force: true })

if (hits.length) {
  console.error("Local-only content found in a deployed-style build:\n" + hits.join("\n"))
  process.exit(1)
}
console.log(`ok: deployed-style build contains none of ${forbidden.length} local-only markers`)
