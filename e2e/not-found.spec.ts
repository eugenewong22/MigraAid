import { expect, test } from "@playwright/test";
import en from "../messages/en.json";

test("an unmatched route under a locale renders the localized 404, not a crash", async ({
  page,
}) => {
  // not-found.tsx does not receive `params`; it must resolve the locale from
  // the ambient request context. A regression here surfaces as a 500 with
  // Next's default error page instead of the Daybreak 404.
  const response = await page.goto("/en/this-route-does-not-exist");
  expect(response?.status()).toBe(404);

  await expect(
    page.getByRole("heading", { name: en.notFound.title }),
  ).toBeVisible();
  // The page's own recovery CTAs (scoped away from the header nav, which also
  // links to Emergency). The "Home" label is unique to the 404 CTA block.
  await expect(page.getByRole("link", { name: en.notFound.home })).toHaveAttribute(
    "href",
    "/en",
  );
  // The header nav renders an Emergency link first; the 404 CTA is the last one.
  await expect(
    page.getByRole("link", { name: en.nav.emergency }).last(),
  ).toHaveAttribute("href", "/en/emergency");
});
