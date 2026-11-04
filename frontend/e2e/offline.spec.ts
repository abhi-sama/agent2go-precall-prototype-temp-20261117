import { expect, test } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.removeItem("a2g.local.userId"))
})

async function queuedCount(page: import("@playwright/test").Page) {
  return page.evaluate(async () => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open("a2g-offline-v1")
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const entries = request.result.transaction("queue", "readonly").objectStore("queue").count()
      entries.onsuccess = () => resolve(entries.result)
      entries.onerror = () => reject(entries.error)
    }
  }))
}

test.describe("encrypted MSL offline workspace", () => {
  test("an encrypted brief is readable offline and an edit queues then flushes on reconnect", async ({ page, context }) => {
    await page.goto("/msl/briefs?brief=br-20261103090000-aaaaaaaa")
    await expect(page.getByTestId("brief")).toBeVisible()
    await page.evaluate(async () => { await navigator.serviceWorker.ready })
    // The first controlled reload gives the worker the route shell it needs when the radio is unavailable.
    await page.reload()
    await expect(page.getByTestId("brief")).toBeVisible()
    const cached = await page.evaluate(async () => new Promise<{ ciphertextBytes: number; hasPlaintext: boolean }[]>((resolve, reject) => {
      const request = indexedDB.open("a2g-offline-v1")
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const entries = request.result.transaction("cache", "readonly").objectStore("cache").getAll()
        entries.onsuccess = () => resolve(entries.result.map((entry) => ({ ciphertextBytes: entry.ciphertext?.byteLength ?? 0, hasPlaintext: "data" in entry })))
        entries.onerror = () => reject(entries.error)
      }
    }))
    expect(cached.some((entry) => entry.ciphertextBytes > 0 && !entry.hasPlaintext)).toBe(true)

    await context.setOffline(true)
    await page.reload()
    await expect(page.getByTestId("brief")).toBeVisible()
    await expect(page.getByTestId("offline-status")).toContainText("Offline")
    await page.getByTestId("brief-objective").fill("Review access evidence with the care team")
    await page.getByTestId("brief-save").click()
    await expect(page.getByTestId("offline-status")).toContainText("1 queued")

    await context.setOffline(false)
    await page.evaluate(() => window.dispatchEvent(new Event("online")))
    await expect.poll(() => queuedCount(page), { timeout: 10_000 }).toBe(0)
  })

  test("an offline flag is delivered once after reconnect", async ({ page, context }) => {
    await page.goto("/msl/activity")
    await expect(page.getByTestId("flags-empty")).toBeVisible()
    await context.setOffline(true)
    await page.getByTestId("flag-open").click()
    await page.getByTestId("flag-kind-SUMMARY").click()
    await page.getByTestId("flag-target-id").fill("SUMMARY-0001")
    await page.getByTestId("flag-note").fill("The summary needs a source check.")
    await page.getByTestId("flag-submit").click()
    await expect(page.getByTestId("flag-sent")).toBeVisible()
    await expect(page.getByTestId("offline-status")).toContainText("1 queued")

    await context.setOffline(false)
    await page.evaluate(() => window.dispatchEvent(new Event("online")))
    await expect.poll(() => queuedCount(page), { timeout: 10_000 }).toBe(0)
  })
})
