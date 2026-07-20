import type { MetadataRoute } from "next";

/** Web app manifest — makes MigraAid installable as a PWA on a worker's phone. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MigraAid",
    short_name: "MigraAid",
    description:
      "Multilingual rights and support hub for migrant workers in Singapore.",
    start_url: "/",
    display: "standalone",
    // Daybreak cream — must track globals.css --color-cream so the installed
    // PWA splash/status chrome matches the app instead of flashing a stale
    // palette.
    background_color: "#faf6ef",
    theme_color: "#faf6ef",
    icons: [
      // Both purposes point at the same files: "maskable" so Android/adaptive
      // launchers can safely crop to their shape, and "any" so non-masking
      // launchers/desktop installs (which otherwise treat a maskable-only
      // icon as croppable) render the icon uncropped.
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
