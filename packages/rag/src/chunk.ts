export interface ChunkOptions {
  maxChars?: number;
  overlapChars?: number;
}

export interface TextChunk {
  text: string;
  index: number;
}

/**
 * Sentence/paragraph-aware sliding-window chunker. Splits on paragraph
 * boundaries first so chunks don't cut through a price or policy sentence
 * mid-way (which would otherwise let a retrieval return a technically-
 * present-but-truncated fact — a direct anti-hallucination risk).
 */
export function chunkText(text: string, options: ChunkOptions = {}): TextChunk[] {
  const maxChars = options.maxChars ?? 1200;
  const overlapChars = options.overlapChars ?? 150;

  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  const chunks: TextChunk[] = [];
  let current = "";

  const flush = () => {
    if (current.trim().length > 0) {
      chunks.push({ text: current.trim(), index: chunks.length });
    }
    current = "";
  };

  for (const para of paragraphs) {
    if (para.length > maxChars) {
      // Long paragraph: hard-split with overlap rather than dropping it.
      flush();
      let start = 0;
      while (start < para.length) {
        const end = Math.min(start + maxChars, para.length);
        chunks.push({ text: para.slice(start, end).trim(), index: chunks.length });
        start = end - overlapChars;
        if (start <= 0 || end === para.length) break;
      }
      continue;
    }

    if (current.length + para.length + 2 > maxChars) {
      flush();
      // carry a small overlap from the end of the previous chunk for context continuity
      const prevTail = chunks.at(-1)?.text.slice(-overlapChars) ?? "";
      current = prevTail ? `${prevTail}\n\n${para}` : para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  flush();

  return chunks;
}
