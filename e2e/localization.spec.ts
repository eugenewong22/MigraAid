import { expect, test } from "@playwright/test";
import bn from "../messages/bn.json";
import en from "../messages/en.json";

test("localized home exposes its disclaimer and language control", async ({ page }) => {
  await page.goto("/bn");

  await expect(page.locator("html")).toHaveAttribute("lang", "bn");
  await expect(page.getByText(bn.home.disclaimer, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: bn.common.language }),
  ).toHaveValue("bn");
});

test("locale switching preserves a deep route and its safety disclaimer", async ({
  page,
}) => {
  await page.goto("/bn/chat");

  await expect(page.getByRole("heading", { name: bn.chat.title })).toBeVisible();
  await expect(page.getByText(bn.home.disclaimer, { exact: true })).toBeVisible();

  await page
    .getByRole("combobox", { name: bn.common.language })
    .selectOption("en");

  await expect(page).toHaveURL(/\/en\/chat$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: en.chat.title })).toBeVisible();
  await expect(page.getByText(en.home.disclaimer, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: en.common.language }),
  ).toHaveValue("en");
});
