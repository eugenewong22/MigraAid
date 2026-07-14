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
    // TODO(M6): add 192px and 512px maskable icons + offline service worker.
    icons: [],
  };
}
