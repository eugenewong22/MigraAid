import { expect, test } from "@playwright/test";
import en from "../messages/en.json";

test("contract upload rejects invalid files locally and routes serious clauses to help", async ({
  page,
}) => {
  let contractRequests = 0;
  await page.route("**/api/contract", async (route) => {
    contractRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        summary: "This contract contains a clause that needs urgent review.",
        keyTerms: [{ label: "Salary", value: "S$900 per month" }],
        flaggedClauses: [
          {
            clause: "The employer may keep the worker's passport.",
            concern: "A worker should retain control of their identity documents.",
            severity: "serious",
          },
        ],
      }),
    });
  });

  await page.goto("/en/contract");
  const fileInput = page.locator("#contract-file");
  await fileInput.setInputFiles({
    name: "contract.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });

  const validationError = page.getByText(en.contract.errorInvalidFile, {
    exact: true,
  });
  await expect(validationError).toBeVisible();
  await expect(validationError).toHaveAttribute("role", "alert");
  expect(contractRequests).toBe(0);

  await fileInput.setInputFiles({
    name: "contract.png",
    mimeType: "image/png",
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });

  await expect(
    page.getByRole("heading", { name: en.contract.summary }),
  ).toBeVisible();
  await expect(page.getByText("The employer may keep the worker's passport.")).toBeVisible();
  await expect(page.getByText(`${en.contract.severity}: ${en.contract.severitySerious}`)).toBeVisible();
  await expect(
    page.getByRole("link", { name: en.contract.seriousCta }),
  ).toHaveAttribute("href", "/en/emergency");
  expect(contractRequests).toBe(1);
});
