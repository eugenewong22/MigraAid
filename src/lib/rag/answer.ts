/**
 * Grounded answer generation with Claude.
 *
 * Safety-critical construction:
 *  - Sources are passed as `document` blocks with `citations: {enabled: true}`, so
 *    the response carries span-level source attributions we surface in the UI.
 *  - The system prompt is a frozen, prompt-cached block (cache reads ~0.1x input).
 *  - A `refer_to_human` tool lets the model escalate high-stakes/uncertain cases
 *    instead of answering; we record that on the message.
 */
import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "@/lib/safety/prompt";
import type { AnswerOptions, Citation, RagAnswer, RetrievedChunk } from "./types";

const MODEL = "claude-opus-4-8";
const MAX_TOKENS = 1024;

const REFER_TOOL: Anthropic.Tool = {
  name: "refer_to_human",
  description:
    "Call this when the worker's issue is high-stakes (unpaid salary, workplace injury, " +
    "dismissal, contract dispute, threats/abuse, immigration status, repatriation) or when the " +
    "source documents do not contain enough verified information to answer safely.",
  input_schema: {
    type: "object",
    properties: {
      issue_type: { type: "string", description: "Short slug describing the issue." },
    },
    required: ["issue_type"],
  },
};

function getClient() {
  // Reads ANTHROPIC_API_KEY (or an `ant auth login` profile) from the environment.
  return new Anthropic();
}

function systemBlocks(locale: string): Anthropic.TextBlockParam[] {
  return [
    {
      type: "text",
      text: buildSystemPrompt(locale),
      cache_control: { type: "ephemeral" },
    },
  ];
}

function buildMessages(opts: AnswerOptions): Anthropic.MessageParam[] {
  const docs: Anthropic.ContentBlockParam[] = opts.chunks.map((chunk) => ({
    type: "document",
    source: { type: "text", media_type: "text/plain", data: chunk.text },
    title: chunk.sourceRef,
    citations: { enabled: true },
  }));
  return [{ role: "user", content: [...docs, { type: "text", text: opts.query }] }];
}

function parseMessage(msg: Anthropic.Message, chunks: RetrievedChunk[]): RagAnswer {
  let text = "";
  const citations: Citation[] = [];
  let escalated = false;
  let issueType: string | undefined;

  for (const block of msg.content) {
    if (block.type === "text") {
      text += block.text;
      for (const cit of block.citations ?? []) {
        // Document citations carry a document_index; web-search citations don't.
        if (!("document_index" in cit)) continue;
        const chunk = chunks[cit.document_index];
        citations.push({
          sourceRef: cit.document_title ?? chunk?.sourceRef ?? "",
          contentItemId: chunk?.contentItemId ?? "",
          quote: "cited_text" in cit ? cit.cited_text : undefined,
        });
      }
    } else if (block.type === "tool_use" && block.name === "refer_to_human") {
      escalated = true;
      const input = block.input as { issue_type?: string };
      if (input?.issue_type) issueType = input.issue_type;
    }
  }

  return { text, citations, escalated, issueType, model: MODEL };
}

/** Non-streaming answer (used by the eval harness and server-side callers). */
export async function answer(opts: AnswerOptions): Promise<RagAnswer> {
  const msg = await getClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemBlocks(opts.locale),
    tools: [REFER_TOOL],
    messages: buildMessages(opts),
  });
  return parseMessage(msg, opts.chunks);
}

/**
 * Streaming answer for the chat UI. `textStream` yields text deltas as they
 * arrive; `final()` resolves the complete answer (with citations + escalation)
 * once the stream ends.
 */
export function streamAnswer(opts: AnswerOptions): {
  textStream: AsyncIterable<string>;
  final: () => Promise<RagAnswer>;
} {
  const stream = getClient().messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemBlocks(opts.locale),
    tools: [REFER_TOOL],
    messages: buildMessages(opts),
  });

  async function* textStream(): AsyncIterable<string> {
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield event.delta.text;
      }
    }
  }

  return {
    textStream: textStream(),
    final: async () => parseMessage(await stream.finalMessage(), opts.chunks),
  };
}
