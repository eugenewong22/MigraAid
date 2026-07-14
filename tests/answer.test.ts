import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { parseMessage } from "@/lib/rag/answer";
import type { RetrievedChunk } from "@/lib/rag/types";

const chunks: RetrievedChunk[] = [
  {
    chunkId: "c1",
    contentItemId: "item-1",
    sourceRef: "Employment Act — salary payment",
    domain: "legal_rights",
    text: "Salary must be paid within 7 days.",
    score: 0.9,
  },
];

describe("parseMessage", () => {
  it("extracts text and maps citations back to their source chunk", () => {
    const msg = {
      content: [
        {
          type: "text",
          text: "Your salary must be paid within 7 days.",
          citations: [
            {
              type: "char_location",
              document_index: 0,
              document_title: "Employment Act — salary payment",
              cited_text: "within 7 days",
              start_char_index: 0,
              end_char_index: 13,
            },
          ],
        },
      ],
    } as unknown as Anthropic.Message;

    const answer = parseMessage(msg, chunks);
    expect(answer.text).toContain("7 days");
    expect(answer.escalated).toBe(false);
    expect(answer.citations).toHaveLength(1);
    expect(answer.citations[0].sourceRef).toBe("Employment Act — salary payment");
    expect(answer.citations[0].contentItemId).toBe("item-1");
    expect(answer.citations[0].quote).toBe("within 7 days");
  });

  it("detects escalation and captures the issue type from the tool call", () => {
    const msg = {
      content: [
        { type: "text", text: "This is serious.", citations: null },
        {
          type: "tool_use",
          id: "t1",
          name: "refer_to_human",
          input: { issue_type: "unpaid_salary" },
        },
      ],
    } as unknown as Anthropic.Message;

    const answer = parseMessage(msg, chunks);
    expect(answer.escalated).toBe(true);
    expect(answer.issueType).toBe("unpaid_salary");
  });
});
