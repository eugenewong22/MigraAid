import { expect, test } from "@playwright/test";
import en from "../messages/en.json";

test("the home emergency link reaches callable contacts and navigates back", async ({
  page,
}) => {
  await page.goto("/en");
  await page.getByRole("link", { name: en.home.emergencyCta }).click();

  await expect(page).toHaveURL(/\/en\/emergency$/);
  await expect(
    page.getByRole("heading", { name: en.emergency.title }),
  ).toBeVisible();
  await expect(page.getByText(en.emergency.intro, { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Police: 999" })).toHaveAttribute(
    "href",
    "tel:999",
  );
  // The "unsafe to speak" path is an sms: link, not tel: — assert it survives.
  await expect(page.locator('a[href="sms:70999"]')).toBeVisible();

  // The redesigned header replaces the "Back" link with the MigraAid wordmark,
  // which returns to the localized home page.
  await page.getByRole("link", { name: en.home.title, exact: true }).click();
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.getByRole("heading", { name: en.home.title })).toBeVisible();
});
