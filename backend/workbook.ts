import ExcelJS from "exceljs";
import { fromBuffer } from "yauzl";
import { check, HttpError } from "./errors.ts";
import type { Passage } from "./extract.ts";

// Validate actual expanded bytes before the workbook parser allocates its object model.
async function inspectArchive(bytes: Buffer) {
  await new Promise<void>((resolve, reject) => {
    fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error)
        return reject(
          new HttpError(
            415,
            "Invalid XLSX archive. Save it again as an unencrypted .xlsx workbook.",
          ),
        );
      let size = 0;
      let entries = 0;
      const names = new Set<string>();
      const fail = (error: Error) => {
        zip.close();
        reject(error);
      };
      zip.on("error", fail);
      zip.on("end", () => {
        zip.close();
        if (!names.has("xl/workbook.xml") || !names.has("[Content_Types].xml"))
          reject(new HttpError(415, "This archive is not an XLSX workbook."));
        else resolve();
      });
      zip.on("entry", (entry) => {
        if (++entries > 10000 || size + entry.uncompressedSize > 64 * 1024 * 1024)
          return fail(
            new HttpError(
              413,
              "Workbook expands beyond the processing limit (64 MB or 10,000 archive entries). Reduce embedded media or split the workbook.",
            ),
          );
        if (entry.generalPurposeBitFlag & 1)
          return fail(
            new HttpError(
              415,
              "Password-encrypted workbooks are not supported. Upload an unencrypted .xlsx copy.",
            ),
          );
        names.add(entry.fileName);
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) return fail(error || new Error("Cannot read workbook archive."));
          stream.on("error", fail);
          stream.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > 64 * 1024 * 1024) {
              stream.destroy();
              fail(new HttpError(413, "Workbook expands beyond the 64 MB processing limit."));
            }
          });
          stream.on("end", () => zip.readEntry());
        });
      });
      zip.readEntry();
    });
  });
}

function valueText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return String(value);
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  if ("text" in value) return value.text;
  if ("error" in value) return `Excel error ${value.error}`;
  return "";
}

export async function extractWorkbook(
  bytes: Buffer,
): Promise<{ passages: Passage[]; warnings: string[] }> {
  await inspectArchive(bytes);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    throw new HttpError(
      415,
      "Cannot read this workbook. Save an unencrypted .xlsx copy in Excel and upload it again.",
    );
  }
  check(
    workbook.worksheets.length <= 100,
    413,
    "Workbook exceeds 100 worksheets. Split it into smaller workbooks.",
  );
  const passages: Passage[] = [];
  const warnings: string[] = [
    "Workbook cells are extracted across all worksheets. Charts, images, formatting-only meaning, and external data refresh are not interpreted. Review the original workbook.",
  ];
  let cellCount = 0;
  let characters = 0;
  let formulas = false;
  let missingResults = false;
  for (const sheet of workbook.worksheets) {
    const hidden = sheet.state !== "visible";
    if (hidden)
      warnings.push(
        `Worksheet "${sheet.name}" is hidden; its cells are included. Review before publishing.`,
      );
    const headers = new Map<number, string>();
    let headerRow = 0;
    let rows = 0;
    sheet.eachRow((row, rowNumber) => {
      const cells: { column: number; address: string; text: string; plain: boolean }[] = [];
      row.eachCell((cell, column) => {
        if (cell.isMerged && cell.master.address !== cell.address) return;
        check(
          ++cellCount <= 100000,
          413,
          "Workbook exceeds 100,000 populated cells. Split it into smaller workbooks.",
        );
        let value = cell.value;
        let suffix = "";
        const formula =
          value && typeof value === "object" && ("formula" in value || "sharedFormula" in value);
        if (formula) {
          formulas = true;
          const formulaValue = value as ExcelJS.CellFormulaValue;
          value = formulaValue.result;
          if (value == null) {
            missingResults = true;
            suffix = `[formula ${cell.formula || "shared formula"}; no saved result]`;
          } else suffix = ` [saved result; formula ${cell.formula || "shared formula"}]`;
        }
        let text = valueText(value);
        if (typeof value === "number" && cell.numFmt && cell.numFmt !== "General") {
          if (/^0+$/.test(cell.numFmt) && Number.isInteger(value) && value >= 0)
            text = String(value).padStart(cell.numFmt.length, "0");
          else text += ` [number format: ${cell.numFmt}]`;
        }
        text = (text + suffix).trim();
        if (text)
          cells.push({
            column,
            address: cell.address,
            text,
            plain: !formula && typeof value === "string",
          });
      });
      if (!cells.length) return;
      rows++;
      // Only use a clearly textual early row as a header hint; retain its coordinates.
      if (
        !headerRow &&
        rowNumber <= 20 &&
        cells.length >= 2 &&
        cells.every((cell) => cell.plain && cell.text.length <= 100)
      ) {
        headerRow = rowNumber;
        for (const cell of cells) headers.set(cell.column, cell.text);
      }
      const spn = cells.find((cell) => /^SPN$/i.test(headers.get(cell.column) || ""));
      const fmi = cells.find((cell) => /^FMI$/i.test(headers.get(cell.column) || ""));
      const code =
        spn && fmi && /^\d{1,7}$/.test(spn.text) && /^\d{1,2}$/.test(fmi.text)
          ? `SPN ${Number(spn.text)} / FMI ${Number(fmi.text)}\n`
          : "";
      const prefix = `Worksheet: ${sheet.name}${hidden ? " (hidden)" : ""}\n${code}`;
      const fields = cells.map(
        (cell) =>
          `${cell.address}${rowNumber !== headerRow && headers.has(cell.column) ? ` (${headers.get(cell.column)}; header row ${headerRow})` : ""}: ${cell.text}`,
      );
      // Keep each row separate; repeat the tab/code context if a wide row needs multiple passages.
      let content = prefix;
      const emit = () => {
        if (content === prefix) return;
        characters += content.length;
        check(
          characters <= 1000000,
          413,
          "Extracted workbook exceeds one million characters. Split it into smaller workbooks.",
        );
        passages.push({
          locator: `Worksheet "${sheet.name}" · row ${rowNumber}`,
          content: content.trim(),
        });
        content = prefix;
      };
      for (const field of fields) {
        if (content.length + field.length > 1800) emit();
        // Oversized individual cells retain their address in every segment.
        for (let offset = 0; offset < field.length; offset += 1400) {
          const part = field.slice(offset, offset + 1400);
          if (content.length + part.length > 1800) emit();
          content += `${offset ? `[${field.split(":")[0]} continued] ` : ""}${part}\n`;
        }
      }
      emit();
    });
    warnings.push(
      `Worksheet "${sheet.name}": ${rows} nonempty rows extracted${hidden ? " (hidden)" : ""}.`,
    );
  }
  if (formulas)
    warnings.push(
      "Formulas are not recalculated. Extracted results are the values last saved in Excel and may be stale. Recalculate and save the workbook before uploading.",
    );
  if (missingResults)
    warnings.push(
      "Some formula cells have no saved result. Their formulas are retained, but the app cannot supply their calculated values.",
    );
  return { passages, warnings };
}
