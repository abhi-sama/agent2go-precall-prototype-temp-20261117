import { expect, test, type Page } from "@playwright/test"

/** Captain's viewport matrix (2026-11-04): desktops from a 13-inch MacBook up, and every iPad Air/Pro in both orientations. */
const VIEWPORTS: { name: string; width: number; height: number; tablet?: boolean }[] = [
  { name: "MacBook Air 13 (1280x800)", width: 1280, height: 800 },
  { name: "MacBook Air 13 (1470x956)", width: 1470, height: 956 },
  { name: "MacBook Pro 14", width: 1512, height: 982 },
  { name: "MacBook Pro 16", width: 1728, height: 1117 },
  { name: "Desktop 1080p", width: 1920, height: 1080 },
  { name: "Desktop 1440p", width: 2560, height: 1440 },
  { name: "iPad Air 11 portrait", width: 820, height: 1180, tablet: true },
  { name: "iPad Air 11 landscape", width: 1180, height: 820, tablet: true },
  { name: "iPad Pro 11 portrait", width: 834, height: 1194, tablet: true },
  { name: "iPad Pro 11 landscape", width: 1194, height: 834, tablet: true },
  { name: "iPad Air 13 portrait", width: 1024, height: 1366, tablet: true },
  { name: "iPad Air 13 landscape", width: 1366, height: 1024, tablet: true },
  { name: "iPad Pro 13 portrait", width: 1032, height: 1376, tablet: true },
  { name: "iPad Pro 13 landscape", width: 1376, height: 1032, tablet: true },
]

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("a2g.local.userId", "u-admin-sec"))
})

const tab = (page: Page, name: string) => page.getByRole("tab", { name })

test("administrator validates the hierarchy, approves coverage, and keeps catalog apart from responses", async ({ page }) => {
  await page.goto("/admin/governance")
  await expect(page.getByRole("heading", { level: 1, name: "Hierarchy and coverage" })).toBeVisible()

  // Cycles and orphans are called out, and the tree shows them outside any root.
  const findings = page.getByTestId("hierarchy-findings")
  await expect(findings).toContainText("Cycle: CYC-A → CYC-B → CYC-A")
  await expect(findings).toContainText("UNRESOLVED-01 is in use but has no parent")
  await expect(page.getByTestId("hierarchy-counts")).toContainText("2 to fix")
  await expect(page.getByTestId("hierarchy-unreached")).toContainText("UNRESOLVED-01")
  await expect(page.getByTestId("hierarchy-tree")).toContainText("REGION-NE")

  // Inheritance is one tap away.
  await page.getByRole("button", { name: "Show details for NE-02" }).first().click()
  await expect(page.getByText("Inherited from above").first()).toBeVisible()
  await expect(page.getByText("Dana Whitfield primary via REGION-NE").first()).toBeVisible()

  // Temporary coverage needs an end date; a request is approved by a different administrator.
  await tab(page, "Access timeline").click()
  await expect(page.getByTestId("access-timeline")).toContainText("expired")
  await expect(page.getByTestId("access-timeline")).toContainText("active")
  const pending = page.locator('[data-testid="scope-change-request"][data-status="PENDING"]')
  await expect(pending).toContainText("Requested by u-admin-ops")
  await pending.getByRole("button", { name: "Approve" }).click()
  await expect(page.getByTestId("scope-change-request").filter({ hasText: "Territory realignment" })).toContainText("Approved by u-admin-sec")
  await expect(page.getByTestId("access-timeline")).toContainText("scheduled")

  const form = page.getByTestId("scope-change-form")
  await expect(form.getByLabel("Expires (required)")).toBeVisible()
  await form.getByLabel("Type").selectOption("TRANSFER")
  await expect(form.getByLabel("Expires (required)")).toHaveCount(0)
  await expect(form.getByLabel("Moves from")).toBeVisible()

  // Catalog visibility and response access are separate controls.
  await tab(page, "Catalog and responses").click()
  await expect(page.getByTestId("visibility-principle")).toContainText("never grants seeing its responses")
  const catalog = page.getByTestId("catalog-matrix").getByRole("switch", { name: "Executive aggregate-only role can see the question catalog" })
  await expect(catalog).not.toBeChecked()
  const responseGroup = page.getByRole("radiogroup", { name: "Executive aggregate-only role response access" })
  await expect(responseGroup.getByRole("radio", { name: "Aggregate only" })).toBeChecked()
  await catalog.click()
  await expect(catalog).toBeChecked()
  await expect(page.getByRole("status").filter({ hasText: "Catalog visibility saved" })).toBeVisible()
  await expect(responseGroup.getByRole("radio", { name: "Aggregate only" })).toBeChecked()
  await expect(responseGroup.getByRole("radio", { name: "Records" })).not.toBeChecked()
})

test("a non-administrator gets a gate, not the governance data", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("a2g.local.userId", "u-msl-ne-01"))
  await page.goto("/admin/governance")
  await expect(page.getByTestId("role-gate")).toBeVisible()
  await expect(page.getByTestId("hierarchy-findings")).toHaveCount(0)
})

test.describe("viewport matrix", () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name}: no overflow, no overlap, 44pt targets`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "ipad-landscape", "the matrix sets its own viewports; run it once")
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto("/admin/governance")
      for (const name of ["Hierarchy", "Access timeline", "Catalog and responses"]) {
        await tab(page, name).click()
        await expect(page.getByRole("tabpanel", { name })).toBeVisible()
        await expect(tab(page, name)).toHaveAttribute("aria-selected", "true")
        await page.waitForLoadState("networkidle")
        // Wait out the panel cross-fade and the mock adapter's latency.
        await expect(page.getByRole("tabpanel", { name }).getByRole("status").or(page.getByRole("tabpanel", { name }).locator("h2").first())).toBeVisible()
        await page.waitForTimeout(600)
        if (name === "Hierarchy") await page.getByRole("button", { name: "Show details for NE-01" }).first().click()

        const report = await page.evaluate(() => {
          const doc = document.documentElement
          const wide = [...document.querySelectorAll<HTMLElement>("main *")]
            .filter((el) => el.getBoundingClientRect().right > doc.clientWidth + 1 && getComputedStyle(el).position !== "fixed")
            .slice(0, 5)
            .map((el) => `${el.tagName}.${el.className.toString().slice(0, 40)}`)
          const small = [...document.querySelectorAll<HTMLElement>("main button, main input, main select, main [role=radio], main [role=tab], main [role=switch]")]
            .map((el) => ({ el, box: (el.closest("label") ?? el).getBoundingClientRect() }))
            .filter(({ box }) => box.width > 0 && box.height < 43.5)
            .slice(0, 5)
            .map(({ el }) => `${el.tagName}[${el.getAttribute("aria-label") ?? el.textContent?.slice(0, 20)}]`)
          return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, wide, small }
        })
        expect(report.scrollWidth, `${name}: horizontal scroll`).toBeLessThanOrEqual(report.clientWidth)
        expect(report.wide, `${name}: elements past the right edge`).toEqual([])
        if (viewport.tablet) expect(report.small, `${name}: touch targets under 44pt`).toEqual([])
      }
    })
  }
})
