/**
 * Heading-aware markdown chunker. Splits on blank lines (paragraph boundaries)
 * and packs paragraphs up to a character budget (~300 tokens by default). Pure
 * and deterministic so it is easy to unit-test and reason about.
 */
export function chunkMarkdown(
  text: string,
  opts?: { maxChars?: number },
): string[] {
  const maxChars = opts?.maxChars ?? 1200;
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    // Flush before adding a paragraph that would overflow the budget.
    if (current && current.length + paragraph.length + 2 > maxChars) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
    // A single very long paragraph becomes its own chunk.
    if (current.length >= maxChars) {
      chunks.push(current);
      current = "";
    }
  }

  if (current) chunks.push(current);
  return chunks;
}
