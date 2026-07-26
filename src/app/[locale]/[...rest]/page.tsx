import { notFound } from "next/navigation";

/**
 * Catch-all so any path under /[locale] that matches no real page renders the
 * localized not-found.tsx (with the locale context the layout established)
 * instead of Next's unstyled English default 404. This is the lowest-priority
 * match — concrete routes (/chat, /contract, /emergency) always win — and
 * calling notFound() hands off to the sibling not-found boundary.
 */
export default function CatchAllNotFound(): never {
  notFound();
}
