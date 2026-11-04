/**
 * The shared responsive viewport matrix (captain, 2026-11-04): desktop from a 13-inch MacBook upward, and iPad
 * Air and every larger iPad in both orientations. `playwright.config.ts` builds one Playwright project per entry,
 * so every screen registered in `screens.ts` is checked at every size. Add a size here, never in a spec.
 */
export interface MatrixViewport {
  /** Project name and screenshot folder: kebab-case, unique. */
  name: string
  width: number
  height: number
  /** Tablets: touch input emulated, and touch targets must be at least 44pt. */
  touch: boolean
}

const desktop = (name: string, width: number, height: number): MatrixViewport => ({ name, width, height, touch: false })
const ipad = (name: string, portrait: [number, number]): MatrixViewport[] => [
  { name: `${name}-portrait`, width: portrait[0], height: portrait[1], touch: true },
  { name: `${name}-landscape`, width: portrait[1], height: portrait[0], touch: true },
]

export const VIEWPORTS: MatrixViewport[] = [
  desktop("macbook-air-13-1280x800", 1280, 800),
  desktop("macbook-air-13-1470x956", 1470, 956),
  desktop("macbook-pro-14-1512x982", 1512, 982),
  desktop("macbook-pro-16-1728x1117", 1728, 1117),
  desktop("desktop-1920x1080", 1920, 1080),
  desktop("desktop-2560x1440", 2560, 1440),
  ...ipad("ipad-air-11", [820, 1180]),
  ...ipad("ipad-pro-11", [834, 1194]),
  ...ipad("ipad-air-13", [1024, 1366]),
  ...ipad("ipad-pro-13", [1032, 1376]),
]

/** The two projects that also run the functional specs (smoke, activity, chat, map): the baseline iPad Air 11. */
export const FUNCTIONAL_PROJECTS = ["ipad-air-11-portrait", "ipad-air-11-landscape"]
