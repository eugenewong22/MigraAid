/**
 * Heading-aware markdown chunker. Splits on blank lines (paragraph boundaries)
 * and packs paragraphs up to a character budget (~300 tokens by default). Pure
 * and deterministic so it is easy to unit-test and reason about.
 */
export function chunkMarkdown(
  text: string,
  opts?: { maxChars?: number },
): string[] {
  const maxChars = Math.max(1, Math.floor(opts?.maxChars ?? 1200));
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((paragraph) => splitOversizedParagraph(paragraph, maxChars));

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    // Flush before adding a paragraph that would overflow the budget.
    if (current && current.length + paragraph.length + 2 > maxChars) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
    if (current.length >= maxChars) {
      chunks.push(current);
      current = "";
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

/**
 * Legal source documents often contain a whole section without blank lines.
 * Keep every resulting vector chunk bounded, preferring a nearby sentence or
 * word boundary and falling back to a hard split for scripts/text without one.
 */
function splitOversizedParagraph(paragraph: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let remaining = paragraph;

  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars + 1);
    const minimumUsefulBreak = Math.floor(maxChars * 0.55);
    let splitAt = -1;

    for (
      let index = Math.min(maxChars - 1, window.length - 1);
      index >= minimumUsefulBreak;
      index -= 1
    ) {
      if (/[\s.!?。！？।,;:，；：]/u.test(window[index])) {
        splitAt = index + 1;
        break;
      }
    }

    if (splitAt <= 0) splitAt = maxChars;
    const piece = remaining.slice(0, splitAt).trim();
    if (piece) pieces.push(piece);
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) pieces.push(remaining);
  return pieces;
}
