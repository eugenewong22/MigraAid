/**
 * The one place this project makes an outbound request to a public website.
 *
 * Every guard here exists because we are a guest on someone else's server:
 * we identify ourselves, we go slowly, we refuse to follow a redirect off
 * HTTPS, and we cap how much we will read.
 */

const USER_AGENT =
  "MigraAid-source-fetch/1.0 (+https://github.com/eugenewong22/migraaid; knowledge-base source verification)";
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
/** Floor between requests to one host. Raised per source by its crawl-delay. */
export const DEFAULT_HOST_INTERVAL_MS = 2_000;

const lastRequestAt = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * At most one request per host per `intervalMs`.
 *
 * Several of these hosts publish a `Crawl-delay` well above our floor (Singapore
 * Statutes Online asks 6s, TWC2 asks 20s). Honouring it is the whole point of
 * having checked robots.txt, so the caller passes the host's stated delay.
 */
async function throttle(hostname: string, intervalMs: number): Promise<void> {
  const previous = lastRequestAt.get(hostname);
  if (previous !== undefined) {
    const wait = intervalMs - (Date.now() - previous);
    if (wait > 0) await sleep(wait);
  }
  lastRequestAt.set(hostname, Date.now());
}

export interface FetchedSource {
  bytes: Uint8Array;
  contentType: string;
  finalUrl: string;
}

export async function fetchPublicDocument(
  url: string,
  options: { crawlDelaySeconds?: number } = {},
): Promise<FetchedSource> {
  const intervalMs = Math.max(
    DEFAULT_HOST_INTERVAL_MS,
    (options.crawlDelaySeconds ?? 0) * 1_000,
  );
  let current = new URL(url);
  if (current.protocol !== "https:") {
    throw new Error(`refusing to fetch non-HTTPS URL: ${url}`);
  }

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    await throttle(current.hostname, intervalMs);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(current, {
        headers: { "user-agent": USER_AGENT, accept: "text/html,text/plain,*/*" },
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`redirect with no location from ${current}`);
      const next = new URL(location, current);
      // A redirect to plain HTTP would silently downgrade the whole fetch.
      if (next.protocol !== "https:") {
        throw new Error(`refusing redirect to non-HTTPS URL: ${next}`);
      }
      current = next;
      continue;
    }

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText} from ${current}`);
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) {
      throw new Error(
        `${current} returned ${buffer.byteLength} bytes, over the ${MAX_BYTES} cap`,
      );
    }

    return {
      bytes: new Uint8Array(buffer),
      contentType: response.headers.get("content-type") ?? "",
      finalUrl: current.toString(),
    };
  }

  throw new Error(`too many redirects fetching ${url}`);
}
