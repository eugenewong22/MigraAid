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
    ],
  };
}
