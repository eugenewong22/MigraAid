"use client";

import { useEffect } from "react";

/**
 * Registers the offline service worker (production only — a SW interferes with
 * Next's HMR in development).
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (
      typeof navigator !== "undefined" &&
      "serviceWorker" in navigator &&
      process.env.NODE_ENV === "production"
    ) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* registration is best-effort */
      });
    }
  }, []);
  return null;
}
