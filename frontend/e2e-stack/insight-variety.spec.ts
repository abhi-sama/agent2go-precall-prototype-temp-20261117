import { mkdirSync } from "node:fs"
import { readFileSync } from "node:fs"
import path from "node:path"
import { expect, test } from "@playwright/test"

/**
 * Ticket 27: the seeded insight data is varied (every answer type, themes, emerging topics), and the
 * screens that show it fit the required desktop and iPad viewport matrix. Runs against the real local stack.
 * Set INSIGHT_SHOTS=<dir> to also save a full-page screenshot per viewport.
 */
const outputs = JSON.parse(readFileSync(path.join(__dirname, "..", "amplify_outputs.json"), "utf8"))
const a2g = outputs.custom.a2g as { local_password: string; seeded_users: { userId: string; email: string }[] }

const MATRIX = [
  [1280, 800], [1470, 956], [1512, 982], [1728, 1117], [1920, 1080], [2560, 1440],
  [820, 1180], [1180, 820], [834, 1194], [1194, 834], [1024, 1366], [1366, 1024], [1032, 1376], [1376, 1032],
] as const

test("director insight screens show varied distributions and themes at every viewport", async ({ page }) => {
  test.setTimeout(240_000)
  const director = a2g.seeded_users.find((u) => u.userId === "director-region-01")!
  await page.goto("/login")
  await page.getByTestId("login-email").fill(director.email)
  await page.getByTestId("login-password").fill(a2g.local_password)
  await page.getByTestId("login-submit").click()
  await expect(page).toHaveURL(/\/director$/)

  const shots = process.env.INSIGHT_SHOTS
  if (shots) mkdirSync(shots, { recursive: true })
  for (const [width, height] of MATRIX) {
    await page.setViewportSize({ width, height })
    await page.goto("/director")
    await expect(page.getByTestId("theme-card").first()).toBeVisible({ timeout: 30_000 })
    const distributions = page.locator('[data-testid^="distribution-"]')
    await expect(distributions.first()).toBeVisible()
    // Several answer shapes at a glance: choice, scale, yes/no, ranges, months, first-ranked option.
    expect(await distributions.count()).toBeGreaterThanOrEqual(12)
    expect(await page.getByTestId("theme-card").count()).toBeGreaterThanOrEqual(8)
    const shapes = new Set<string>()
    for (const text of await page.locator('[data-testid^="distribution-"]').allInnerTexts()) {
      if (/Yes|Unsure/.test(text)) shapes.add("yes_no")
      if (/\d+ to \d+/.test(text)) shapes.add("numeric")
      if (/Ranked first:/.test(text)) shapes.add("ranking")
      if (/\b20\d\d-\d\d\b/.test(text)) shapes.add("date")
      if (/First line|Second line/.test(text)) shapes.add("single_choice")
    }
    expect(shapes.size, `${width}x${height} answer shapes ${[...shapes]}`).toBeGreaterThanOrEqual(4)
    const overflowing = await page.evaluate(() => {
      if (document.documentElement.scrollWidth <= window.innerWidth) return []
      return [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
        .slice(0, 6)
        .map((el) => `${el.tagName.toLowerCase()}${el.dataset.testid ? `[${el.dataset.testid}]` : ""}.${String(el.className).slice(0, 60)} right=${Math.round(el.getBoundingClientRect().right)}`)
    })
    expect(overflowing, `${width}x${height} should not overflow horizontally`).toEqual([])
    if (shots) {
      for (const [name, heading] of [["distributions", "response-distributions-heading"], ["themes", "qualitative-insights-heading"]] as const) {
        await page.locator(`#${heading}`).evaluate((el) => el.scrollIntoView({ block: "start" }))
        await page.screenshot({ path: path.join(shots, `director-${name}-${width}x${height}.png`) })
      }
    }
  }
})
