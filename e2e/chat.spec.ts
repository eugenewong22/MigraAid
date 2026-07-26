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

test("an escalated answer renders a localized referral card with a neutral link", async ({
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
        text: "This looks serious. [1]",
        conversationId,
        messageId,
        citations: [{ sourceRef: "MOM", contentItemId: "33333333-3333-4333-8333-333333333333" }],
        escalated: true,
        // The API still sends the English `org`/`reason`; the client must render
        // the localized emergency-catalog name and a neutral link, not these.
        referrals: [
          {
            orgKey: "home",
            org: "HOME — Humanitarian Organisation for Migration Economics",
            contact: "+65 6341 5535",
            reason: "Support for unpaid salary",
          },
          {
            orgKey: "tadm",
            org: "TADM — Tripartite Alliance for Dispute Management",
            contact: "Open TADM eServices",
            href: "https://www.tal.sg/tadm/eservices",
            reason: "Support for unpaid salary",
          },
        ],
      })}\n`,
    });
  });

  await page.goto("/en/chat");
  await page.getByLabel(en.chat.questionLabel).fill("My boss has not paid me.");
  await page.getByRole("button", { name: en.chat.send }).click();

  const answer = page.getByRole("article", { name: en.chat.speakerMigraAid });
  // Localized name + note from the emergency catalog, not the English API string.
  await expect(answer.getByText("HOME Helpline")).toBeVisible();
  await expect(answer).toContainText("Migrant worker support");
  await expect(answer).not.toContainText("Support for unpaid salary");
  // Web link shows the bare hostname; phone contact shows the dialable number.
  await expect(answer.getByRole("link", { name: "tal.sg" })).toHaveAttribute(
    "href",
    "https://www.tal.sg/tadm/eservices",
  );
  await expect(answer.getByRole("link", { name: "+65 6341 5535" })).toHaveAttribute(
    "href",
    "tel:+6563415535",
  );
});

test("accumulates streamed NDJSON text frames before the terminal done frame replaces them", async ({
  page,
}) => {
  const conversationId = "11111111-1111-4111-8111-111111111111";
  const messageId = "22222222-2222-4222-8222-222222222222";
  // page.route().fulfill() only supports a fully-buffered body, so it can't
  // exercise genuine incremental delivery — a previous version of this test
  // fulfilled several `type:"text"` frames plus a terminal `done` all at
  // once, then asserted only the final text, which the `done` frame alone
  // supplies. That passed even with the client's incremental-accumulation
  // path (`type === "text"` in Chat.tsx's send()) fully broken, since the
  // server currently buffers the whole answer and never emits `text` frames
  // (that client path is otherwise dead code, kept for future incremental
  // streaming). Monkeypatching fetch inside the page instead gives a
  // ReadableStream that yields each frame after a real delay, so the partial
  // text genuinely lands in the DOM on its own render before `done` arrives.
  await page.addInitScript(
    ({ frames, delayMs }) => {
      const realFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        if (typeof input !== "string" || !input.includes("/api/chat")) {
          return realFetch(input, init);
        }
        const encoder = new TextEncoder();
        let index = 0;
        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            if (index >= frames.length) {
              controller.close();
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            controller.enqueue(encoder.encode(JSON.stringify(frames[index]) + "\n"));
            index += 1;
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "application/x-ndjson; charset=utf-8" },
        });
      };
    },
    {
      delayMs: 150,
      frames: [
        // This exact text never appears in the `done` frame below, so seeing
        // it in the DOM can only come from incremental accumulation, not the
        // terminal frame.
        { type: "text", text: "Checking sources" },
        { type: "text", text: "…please wait" },
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
      ],
    },
  );

  await page.goto("/en/chat");
  await page.getByLabel(en.chat.questionLabel).fill("When must my salary be paid?");
  await page.getByRole("button", { name: en.chat.send }).click();

  const answer = page.getByRole("article", { name: en.chat.speakerMigraAid });
  // The two `text` frames land first and accumulate in the DOM before `done`.
  await expect(answer).toContainText("Checking sources…please wait");

  // The terminal `done` frame then REPLACES that partial text (`text: evt.text`
  // in Chat.tsx), not appends to it.
  await expect(answer).toContainText(
    "Your salary must be paid within seven days. [1]",
  );
  await expect(answer).not.toContainText("Checking sources");
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
