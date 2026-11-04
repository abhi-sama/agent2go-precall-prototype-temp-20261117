let cache: boolean | undefined

/** True when this browser can make a WebGL context. Checked once per page; false on the server. */
export function detectWebGL(): boolean {
  if (typeof document === "undefined") return false
  if (cache !== undefined) return cache
  try {
    const canvas = document.createElement("canvas")
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl")
    cache = Boolean(gl)
    // Give the context back at once: a page may only hold a handful, and the test canvas is never drawn.
    ;(gl as WebGLRenderingContext | null)?.getExtension("WEBGL_lose_context")?.loseContext()
  } catch {
    cache = false
  }
  return cache
}
