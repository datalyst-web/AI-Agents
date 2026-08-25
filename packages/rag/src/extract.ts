import { parse as parseCsv } from "csv-parse/sync";

export interface ExtractedDocument {
  title: string;
  text: string;
}

/**
 * Document Processing -> Text Extraction step of the RAG pipeline
 * (CLAUDE.md's Knowledge Base diagram). Each extractor takes a raw buffer
 * and produces plain text; chunking happens separately in chunk.ts so this
 * stays testable per-format without a DB or embedding dependency.
 */
export async function extractPdf(buffer: Buffer, filename: string): Promise<ExtractedDocument> {
  const pdfParse = (await import("pdf-parse")).default;
  const result = await pdfParse(buffer);
  return { title: filename, text: result.text };
}

export async function extractDocx(buffer: Buffer, filename: string): Promise<ExtractedDocument> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return { title: filename, text: result.value };
}

export function extractTxt(buffer: Buffer, filename: string): ExtractedDocument {
  return { title: filename, text: buffer.toString("utf-8") };
}

export function extractCsv(buffer: Buffer, filename: string): ExtractedDocument {
  const rows = parseCsv(buffer, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
  const text = rows
    .map((row) =>
      Object.entries(row)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n"),
    )
    .join("\n\n---\n\n");
  return { title: filename, text };
}

export function extractManualFaq(entries: { question: string; answer: string }[]): ExtractedDocument {
  const text = entries.map((e) => `Q: ${e.question}\nA: ${e.answer}`).join("\n\n");
  return { title: "Manual FAQ", text };
}

export async function extractByType(
  type: "PDF" | "DOCX" | "TXT" | "CSV",
  buffer: Buffer,
  filename: string,
): Promise<ExtractedDocument> {
  switch (type) {
    case "PDF":
      return extractPdf(buffer, filename);
    case "DOCX":
      return extractDocx(buffer, filename);
    case "TXT":
      return extractTxt(buffer, filename);
    case "CSV":
      return extractCsv(buffer, filename);
  }
}
