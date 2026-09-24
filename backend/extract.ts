import { extname } from "node:path";
import { mkdir } from "node:fs/promises";
import { check } from "./errors.ts";
import { dataDir } from "./db.ts";
import { diagnosticRows } from "./diagnostics.ts";
export type Passage = { locator: string; content: string };
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const mimeTypes: Record<string, string> = {
  ".txt": "text/plain",
  ".log": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
    "Supported files: PDF, XLSX, TXT, LOG, MD, CSV, TSV, JSON, JSONL, XML, YAML, INI, CONF, DOCX, PNG, JPEG, WebP.",
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
  else if (ext === ".docx" || ext === ".xlsx")
    check(
      bytes[0] === 0x50 && bytes[1] === 0x4b,
      415,
      `This file is not a valid unencrypted ${ext.slice(1).toUpperCase()} file.`,
    );
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
  batch?: { startPage: number; maxPages: number; maxOcrPages: number },
): Promise<{
  passages: Passage[];
  warnings: string[];
  processedPages: number;
  totalPages: number;
  complete: boolean;
}> {
  const mime = validateFile(filename, bytes);
  const warnings: string[] = [];
  let passages: Passage[] = [];
  let processedPages = 0;
  let totalPages = 0;
  let complete = true;
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
      const { getDocument, OPS, Util } = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
      try {
        const pdf = await task.promise;
        totalPages = pdf.numPages;
        const startPage = batch?.startPage ?? 1;
        check(startPage >= 1 && startPage <= totalPages, 400, "Invalid PDF processing checkpoint.");
        let ocrPages = 0;
        let characters = 0;
        for (
          let n = startPage;
          n <= Math.min(pdf.numPages, startPage + (batch?.maxPages ?? pdf.numPages) - 1);
          n++
        ) {
          const page = await pdf.getPage(n);
          const content = await page.getTextContent();
          let value = content.items
            .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
            .join("");
          if (value.trim().length < 30) {
            ocrPages++;
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
          const items = content.items.filter((item) => "str" in item);
          const borders: number[][] = [];
          if (items.some((item) => item.str.trim() === "Diagsmart")) {
            const ops = await page.getOperatorList();
            let matrix = [1, 0, 0, 1, 0, 0];
            const stack: number[][] = [];
            for (let i = 0; i < ops.fnArray.length; i++) {
              const op = ops.fnArray[i],
                args = ops.argsArray[i];
              if (op === OPS.save) stack.push([...matrix]);
              else if (op === OPS.restore) matrix = stack.pop() || [1, 0, 0, 1, 0, 0];
              else if (op === OPS.transform) matrix = Util.transform(matrix, args);
              else if (
                op === OPS.constructPath &&
                args[2]?.length === 4 &&
                matrix[1] === 0 &&
                matrix[2] === 0
              ) {
                const b = args[2];
                const x1 = b[0] * matrix[0] + matrix[4],
                  x2 = b[2] * matrix[0] + matrix[4];
                const y1 = b[1] * matrix[3] + matrix[5],
                  y2 = b[3] * matrix[3] + matrix[5];
                borders.push([
                  Math.min(x1, x2),
                  Math.min(y1, y2),
                  Math.max(x1, x2),
                  Math.max(y1, y2),
                ]);
              }
            }
          }
          const rows = diagnosticRows(items, n, borders);
          // Keep the full page as evidence too, including any continuation text outside recognized rows.
          passages.push(...rows, ...splitPassages(value, `Page ${n}`));
          page.cleanup();
          processedPages = n;
          characters += value.length;
          // Checkpoint before accumulating a whole manual or a long OCR run.
          if (batch && (ocrPages >= batch.maxOcrPages || characters >= 500_000)) break;
        }
        complete = processedPages === totalPages;
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
    } else if (filename.toLowerCase().endsWith(".xlsx")) {
      const { extractWorkbook } = await import("./workbook.ts");
      const result = await extractWorkbook(bytes);
      passages = result.passages;
      warnings.push(...result.warnings);
    } else if (filename.toLowerCase().endsWith(".docx")) {
      const { extractRawText } = await import("mammoth");
      const result = await extractRawText({ buffer: bytes });
      passages = splitPassages(result.value, "DOCX text");
      warnings.push("DOCX extraction includes text; embedded pictures are not interpreted.");
    } else passages = splitPassages(decodeText(bytes));
    check(
      mime === "application/pdf" || passages.reduce((n, p) => n + p.content.length, 0) <= 1_000_000,
      413,
      "Extracted content exceeds one million characters. Split this document.",
    );
    if (!passages.length && !batch)
      warnings.push(
        "No readable text was found. Add a reviewed transcription or description before publication.",
      );
    return { passages, warnings: [...new Set(warnings)], processedPages, totalPages, complete };
  } finally {
    if (ocrWorker) await ocrWorker.terminate();
  }
}
