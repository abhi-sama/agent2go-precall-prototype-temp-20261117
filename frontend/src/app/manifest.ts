import type { MetadataRoute } from "next"

/**
 * Installable app on iPad and desktop. Icons come with the brand mark ticket (the orange-600 mark);
 * until then the install uses the page icon. Offline behaviour belongs to the PWA ticket.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MSL Agent",
    short_name: "MSL Agent",
    description: "Field insight workspace for Medical Science Liaisons.",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#ea580c",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
