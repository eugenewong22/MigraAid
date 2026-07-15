/** Return a safe external citation URL only when the whole source reference is HTTP(S). */
export function sourceReferenceHref(sourceRef: string): string | null {
  try {
    const url = new URL(sourceRef.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
