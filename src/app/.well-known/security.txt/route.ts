import { SITE_URL } from "../../[locale]/layout";

export const runtime = "nodejs";

/**
 * RFC 9116 security.txt.
 *
 * Served as a route rather than a static file so the expiry stays current
 * without anyone remembering to edit it — an expired security.txt is worse than
 * none, because it signals the project is unmaintained.
 */
export function GET() {
  const expires = new Date();
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);

  const body = [
    "# MigraAid — see SECURITY.md in the repository for what is most worth reporting.",
    `Contact: https://github.com/eugenewong22/MigraAid/security/advisories/new`,
    `Expires: ${expires.toISOString()}`,
    "Preferred-Languages: en",
    `Canonical: ${SITE_URL}/.well-known/security.txt`,
    "Policy: https://github.com/eugenewong22/MigraAid/blob/main/SECURITY.md",
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}
