import { expect, test } from "@playwright/test";
import en from "../messages/en.json";

test("a cited answer exposes evidence and binds feedback to that answer", async ({
  page,
}) => {
  const conversationId = "11111111-1111-4111-8111-111111111111";
  const messageId = "22222222-2222-4222-8222-222222222222";
  const sourceRef = "https://www.mom.gov.sg/employment-practices/salary";
  const sourceQuote = "Salary must be paid within seven days after the salary period.";

  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson; charset=utf-8",
      body: `${JSON.stringify({
        type: "done",
        text: "Your salary should be paid within seven days. [1]",
        conversationId,
        messageId,
        citations: [
          {
            sourceRef,
            contentItemId: "33333333-3333-4333-8333-333333333333",
            quote: sourceQuote,
          },
        ],
        escalated: false,
        referrals: [],
      })}\n`,
    });
  });
  await page.route("**/api/feedback", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });

  await page.goto("/en/chat");
  await page.getByLabel(en.chat.questionLabel).fill("When must my salary be paid?");
  await page.getByRole("button", { name: en.chat.send }).click();

  const answer = page.getByRole("article", { name: en.chat.speakerMigraAid });
  await expect(answer).toContainText("Your salary should be paid within seven days. [1]");
  await expect(answer.getByText(en.chat.sources, { exact: true })).toBeVisible();
  await expect(answer.getByRole("link", { name: sourceRef })).toHaveAttribute(
    "href",
    sourceRef,
  );
  await answer.getByText(en.chat.sourceExcerpt, { exact: true }).click();
  await expect(answer.getByText(sourceQuote, { exact: true })).toBeVisible();

  const feedbackRequest = page.waitForRequest("**/api/feedback");
  await answer.getByRole("button", { name: en.chat.feedbackYes }).click();
  const request = await feedbackRequest;
  expect(request.postDataJSON()).toEqual({
    rating: 5,
    conversationId,
    messageId,
  });
  await expect(answer.getByRole("status")).toHaveText(en.chat.thanks);
});

test("accumulates streamed NDJSON text frames into the final answer", async ({
  page,
}) => {
  const conversationId = "11111111-1111-4111-8111-111111111111";
  const messageId = "22222222-2222-4222-8222-222222222222";
  // Multiple text frames followed by the terminal done frame — exercises the
  // incremental parser (split on "\n", accumulate text, done replaces).
  const frames = [
    { type: "text", text: "Your salary " },
    { type: "text", text: "must be paid " },
    { type: "text", text: "within seven days. [1]" },
    {
      type: "done",
      text: "Your salary must be paid within seven days. [1]",
      conversationId,
      messageId,
      citations: [
        {
          sourceRef: "Employment Act, s.21",
          contentItemId: "33333333-3333-4333-8333-333333333333",
        },
      ],
      escalated: false,
      referrals: [],
    },
  ];
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson; charset=utf-8",
      body: frames.map((frame) => JSON.stringify(frame)).join("\n") + "\n",
    });
  });

  await page.goto("/en/chat");
  await page.getByLabel(en.chat.questionLabel).fill("When must my salary be paid?");
  await page.getByRole("button", { name: en.chat.send }).click();

  const answer = page.getByRole("article", { name: en.chat.speakerMigraAid });
  await expect(answer).toContainText(
    "Your salary must be paid within seven days. [1]",
  );
  await expect(answer.getByText(en.chat.sources, { exact: true })).toBeVisible();
});

test("a failed send surfaces an error and restores the typed question", async ({
  page,
}) => {
  const question = "Can my employer hold my passport?";
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson; charset=utf-8",
      body: `${JSON.stringify({ type: "error", message: "boom" })}\n`,
    });
  });

  await page.goto("/en/chat");
  await page.getByLabel(en.chat.questionLabel).fill(question);
  await page.getByRole("button", { name: en.chat.send }).click();

  // The error is announced on the answer, and the question is not lost — it is
  // returned to the composer so the worker can retry without retyping.
  const answer = page.getByRole("article", { name: en.chat.speakerMigraAid });
  await expect(answer.getByRole("alert")).toContainText(en.chat.error);
  await expect(page.getByLabel(en.chat.questionLabel)).toHaveValue(question);
});

test("a failed feedback POST reports the error and keeps the buttons usable", async ({
  page,
}) => {
  const conversationId = "11111111-1111-4111-8111-111111111111";
  const messageId = "22222222-2222-4222-8222-222222222222";
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson; charset=utf-8",
      body: `${JSON.stringify({
        type: "done",
        text: "Your employer cannot keep your passport. [1]",
        conversationId,
        messageId,
        citations: [
          {
            sourceRef: "Passports Act, s.47",
            contentItemId: "33333333-3333-4333-8333-333333333333",
          },
        ],
        escalated: false,
        referrals: [],
      })}\n`,
    });
  });
  await page.route("**/api/feedback", async (route) => {
    await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
  });

  await page.goto("/en/chat");
  await page.getByLabel(en.chat.questionLabel).fill("Can my boss keep my passport?");
  await page.getByRole("button", { name: en.chat.send }).click();

  const answer = page.getByRole("article", { name: en.chat.speakerMigraAid });
  await answer.getByRole("button", { name: en.chat.feedbackYes }).click();

  await expect(answer.getByRole("alert")).toHaveText(en.chat.feedbackError);
  // The buttons are not replaced by the thanks status, so the worker can retry.
  await expect(
    answer.getByRole("button", { name: en.chat.feedbackYes }),
  ).toBeVisible();
});
