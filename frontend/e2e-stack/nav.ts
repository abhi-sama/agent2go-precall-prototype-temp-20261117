import type { Page } from "@playwright/test"

/**
 * Follows a primary-navigation link by name. At and above the desktop breakpoint the rail shows it; on iPad sizes the
 * links live in the navigation sheet behind the menu button (ticket 52), which this opens first.
 */
export async function goToNav(page: Page, name: string) {
  const menu = page.getByTestId("sidebar-menu")
  if (await menu.isVisible()) {
    await menu.click()
    await page.getByTestId("sidebar-sheet").getByRole("link", { name }).click()
  } else {
    await page.getByTestId("sidebar-rail").getByRole("link", { name }).click()
  }
}
