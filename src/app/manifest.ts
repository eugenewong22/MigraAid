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
    background_color: "#ffffff",
    theme_color: "#2563eb",
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
