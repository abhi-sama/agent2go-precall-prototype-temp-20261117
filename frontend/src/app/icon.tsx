import { ImageResponse } from "next/og"

export const size = { width: 512, height: 512 }
export const contentType = "image/png"

/** The orange field and clinician mark stay legible as the small iPad home-screen icon. */
export default function Icon() {
  return new ImageResponse(
    <div style={{ alignItems: "center", background: "#ea580c", color: "white", display: "flex", fontFamily: "Arial", fontSize: 256, fontWeight: 700, height: "100%", justifyContent: "center", width: "100%" }}>
      M
    </div>,
    { ...size },
  )
}
