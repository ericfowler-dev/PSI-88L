import { extname } from "node:path";
import { mkdir } from "node:fs/promises";
import { check } from "./errors.ts";
import { dataDir } from "./db.ts";
export type Passage = { locator: string; content: string };
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const mimeTypes: Record<string, string> = {
  ".txt": "text/plain",
  ".log": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".json": "application/json",
  ".jsonl": "text/plain",
  ".xml": "application/xml",
  ".yaml": "text/plain",
  ".yml": "text/plain",
  ".ini": "text/plain",
  ".conf": "text/plain",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
export function validateFile(filename: string, bytes: Buffer) {
  const ext = extname(filename).toLowerCase();
  const mime = mimeTypes[ext];
  check(
    mime,
    415,
    "Supported files: PDF, TXT, LOG, MD, CSV, TSV, JSON, JSONL, XML, YAML, INI, CONF, DOCX, PNG, JPEG, WebP.",
  );
  check(
    bytes.length > 0 && bytes.length <= MAX_FILE_BYTES,
    413,
    "Files must be nonempty and no larger than 20 MB.",
  );
  if (ext === ".pdf")
    check(
      bytes.subarray(0, 1024).includes(Buffer.from("%PDF-")),
      415,
      "This file is not a valid PDF.",
    );
  else if (ext === ".docx")
    check(bytes[0] === 0x50 && bytes[1] === 0x4b, 415, "This file is not a valid DOCX.");
  else if (mime.startsWith("image/")) {
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const webp =
      bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    check(
      (mime === "image/png" && png) ||
        (mime === "image/jpeg" && jpg) ||
        (mime === "image/webp" && webp),
      415,
      "Image content does not match the file extension.",
    );
  } else decodeText(bytes);
  return mime;
}
export function decodeText(bytes: Buffer) {
  let value: string;
  try {
    const encoding =
      bytes[0] === 0xff && bytes[1] === 0xfe
        ? "utf-16le"
        : bytes[0] === 0xfe && bytes[1] === 0xff
          ? "utf-16be"
          : "utf-8";
    value = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Text must be UTF-8 or UTF-16 encoded.");
  }
  check(!value.includes("\0"), 415, "Binary content is not a supported text document.");
  return value;
}
export function splitPassages(content: string, prefix = ""): Passage[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const result: Passage[] = [];
  let body = "";
  let start = 1;
  const push = (end: number) => {
    if (body.trim())
      result.push({
        locator: prefix ? `${prefix} · lines ${start}–${end}` : `Lines ${start}–${end}`,
        content: body.trim(),
      });
    body = "";
  };
  lines.forEach((line, index) => {
    if (body.length + line.length > 1800) {
      push(index);
      start = index + 1;
    }
    if (!body) start = index + 1;
    if (line.length > 1800) {
      for (let offset = 0; offset < line.length; offset += 1600)
        result.push({
          locator: `${prefix ? `${prefix} · ` : ""}Line ${index + 1}`,
          content: line.slice(offset, offset + 1800),
        });
    } else body += `${line}\n`;
  });
  push(lines.length);
  return result;
}
export async function extract(
  filename: string,
  bytes: Buffer,
): Promise<{ passages: Passage[]; warnings: string[] }> {
  const mime = validateFile(filename, bytes);
  const warnings: string[] = [];
  let passages: Passage[] = [];
  let ocrWorker: Awaited<ReturnType<typeof import("tesseract.js").createWorker>> | undefined;
  async function ocr(image: Buffer) {
    const cachePath = process.env.OCR_CACHE_DIR || `${dataDir()}/ocr`;
    await mkdir(cachePath, { recursive: true });
    ocrWorker ??= await (
      await import("tesseract.js")
    ).createWorker("eng", 1, {
      cachePath,
      logger: () => {},
    });
    const { data } = await ocrWorker.recognize(image);
    if (data.confidence < 75)
      warnings.push(
        "Low-confidence OCR: verify all numbers, units, and labels against the original.",
      );
    return data.text;
  }
  try {
    if (mime === "application/pdf") {
      const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
      const pdf = await task.promise;
      try {
        check(pdf.numPages <= 200, 413, "Split PDFs longer than 200 pages into smaller documents.");
        let ocrPages = 0;
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          const content = await page.getTextContent();
          let value = content.items
            .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
            .join("");
          if (value.trim().length < 30) {
            if (++ocrPages > 20)
              throw new Error(
                "This document needs OCR on more than 20 pages. Split it into smaller PDFs.",
              );
            const { createCanvas } = await import("@napi-rs/canvas");
            const viewport = page.getViewport({ scale: 1.5 });
            check(
              viewport.width * viewport.height < 20_000_000,
              413,
              "PDF page is too large to render.",
            );
            const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
            await page.render({
              canvas: canvas as never,
              canvasContext: canvas.getContext("2d") as never,
              viewport,
            }).promise;
            value = await ocr(canvas.toBuffer("image/png"));
            warnings.push(`Page ${n} was read using OCR; verify technical values.`);
          }
          passages.push(...splitPassages(value, `Page ${n}`));
          page.cleanup();
        }
        warnings.push(
          "PDF text and OCR do not fully interpret diagrams. Review the original figures when relevant.",
        );
      } finally {
        await task.destroy();
      }
    } else if (mime.startsWith("image/")) {
      const { loadImage } = await import("@napi-rs/canvas");
      const image = await loadImage(bytes);
      check(image.width * image.height < 30_000_000, 413, "Image exceeds 30 megapixels.");
      passages = splitPassages(await ocr(bytes), "Image OCR");
      warnings.push(
        "Image OCR captures visible text, not a verified diagnosis of components. Add a reviewed description for visual details.",
      );
    } else if (filename.toLowerCase().endsWith(".docx")) {
      const { extractRawText } = await import("mammoth");
      const result = await extractRawText({ buffer: bytes });
      passages = splitPassages(result.value, "DOCX text");
      warnings.push("DOCX extraction includes text; embedded pictures are not interpreted.");
    } else passages = splitPassages(decodeText(bytes));
    check(
      passages.reduce((n, p) => n + p.content.length, 0) <= 1_000_000,
      413,
      "Extracted content exceeds one million characters. Split this document.",
    );
    if (!passages.length)
      warnings.push(
        "No readable text was found. Add a reviewed transcription or description before publication.",
      );
    return { passages, warnings: [...new Set(warnings)] };
  } finally {
    if (ocrWorker) await ocrWorker.terminate();
  }
}
