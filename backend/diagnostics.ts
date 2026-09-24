export type FaultCode = { spn: string; fmi?: string };
export function faultCode(question: string, history = ""): FaultCode | undefined {
  const value = question.replace(/[‐‑–—]/g, "-").replace(/\u00a0/g, " ");
  let spn = /\bSPN\s*[:#=-]?\s*(\d{1,7})\b/i.exec(value)?.[1];
  let fmi = /\bFMI\s*[:#=-]?\s*(\d{1,2})\b/i.exec(value)?.[1];
  if (!spn && fmi) spn = /\b(\d{1,7})\s*[:/,-]?\s*FMI\b/i.exec(value)?.[1];
  const shorthand = /(?<![\d:/.-])(\d{2,7})\s*[:/-]\s*(\d{1,2})(?!\d|\s*[:/.-]\s*\d)/.exec(value);
  if (
    shorthand &&
    (shorthand[1].length >= 3 ||
      /^\s*\d+\s*[:/-]\s*\d+\s*$/.test(value) ||
      /\b(?:spn|fmi|fault|code|dtc)\b/i.test(value))
  ) {
    spn ??= shorthand[1];
    if (Number(spn) === Number(shorthand[1])) fmi ??= shorthand[2];
  }
  const spaced = /(?:^|\b(?:fault|code|dtc)\s+)(\d{2,7})\s+(\d{1,2})\s*[?.!]?$/i.exec(value);
  if (!spn && spaced) {
    spn = spaced[1];
    fmi = spaced[2];
  }
  if (!spn && fmi && history) spn = faultCode(history)?.spn;
  if (!spn) return undefined;
  return { spn: String(Number(spn)), ...(fmi === undefined ? {} : { fmi: String(Number(fmi)) }) };
}
export function exactFaultMatch(content: string, code: FaultCode) {
  if (code.fmi === undefined) return new RegExp(`\\b${code.spn}\\b`).test(content);
  const labeled = new RegExp(
    `\\bSPN\\s*[:#=-]?\\s*${code.spn}\\s*(?:[/,;·|-]|\\s)*FMI\\s*[:#=-]?\\s*${code.fmi}\\b`,
    "i",
  );
  const reversed = new RegExp(
    `\\bFMI\\s*[:#=-]?\\s*${code.fmi}\\s*(?:[/,;·|-]|\\s)*SPN\\s*[:#=-]?\\s*${code.spn}\\b`,
    "i",
  );
  // Legacy extraction retained table column order: FMI, SPN, diagnostic identifier.
  const table = new RegExp(`\\b${code.fmi}\\s+${code.spn}\\s+P[0-9A-F]{4}\\b`, "i");
  const shorthand = new RegExp(
    `(?<![\\d:/.-])${code.spn}\\s*[:/-]\\s*${code.fmi}(?!\\d|\\s*[:/.-]\\s*\\d)`,
  );
  return (
    labeled.test(content) ||
    reversed.test(content) ||
    table.test(content) ||
    shorthand.test(content)
  );
}

type Item = { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean };
// Recognize diagnostic tables only when their labeled columns and code anchors agree.
// Other pages retain ordinary extraction; uncertain layouts are never guessed.
export function diagnosticRows(
  items: Item[],
  page: number,
  borders: number[][] = [],
): { locator: string; content: string }[] {
  const text = items.filter((i) => i.str.trim());
  const labels = [
    "Description",
    "FMI",
    "SPN",
    "Diagsmart",
    "Related parts",
    "Phenomena",
    "Fault cause",
    "Troubleshooting",
  ];
  const headers = labels.map((label) =>
    text.find((i) => i.str.trim().toLowerCase() === label.toLowerCase()),
  );
  if (headers.some((h) => !h)) return [];
  const columns = headers.map((h) => h!);
  if (columns.some((h, n) => n > 0 && h.transform[4] <= columns[n - 1].transform[4])) return [];
  const headerY = Math.min(...columns.map((i) => i.transform[5]));
  const center = (i: Item) => i.transform[4] + i.width / 2;
  const belongs = (item: Item, col: number) => {
    // Column boundaries lie in the whitespace between header labels.
    const left =
      col === 0
        ? -Infinity
        : (columns[col - 1].transform[4] + columns[col - 1].width + columns[col].transform[4]) / 2;
    const right =
      col === columns.length - 1
        ? Infinity
        : (columns[col].transform[4] + columns[col].width + columns[col + 1].transform[4]) / 2;
    return center(item) >= left && center(item) < right;
  };
  const anchors = text
    .filter((i) => i.transform[5] < headerY - 8 && belongs(i, 2) && /^\d{1,7}$/.test(i.str.trim()))
    .map((spn) => ({
      spn,
      fmi: text.find(
        (i) =>
          belongs(i, 1) &&
          Math.abs(i.transform[5] - spn.transform[5]) < 3 &&
          /^\d{1,2}$/.test(i.str.trim()),
      ),
      dtc: text.find(
        (i) =>
          belongs(i, 3) &&
          Math.abs(i.transform[5] - spn.transform[5]) < 3 &&
          /^P[\dA-F]{4}$/i.test(i.str.trim()),
      ),
    }))
    .filter((a) => a.fmi && a.dtc)
    .sort((a, b) => b.spn.transform[5] - a.spn.transform[5]);
  if (!anchors.length) return [];
  const printed = text
    .find((i) => i.transform[5] > headerY && /^\d+\s*\/\s*\d+$/.test(i.str.trim()))
    ?.str.split("/")[0]
    .trim();
  return anchors.flatMap((anchor) => {
    const lines = borders
      .filter((b) => b[0] < center(anchor.spn) && b[2] > center(anchor.spn) && b[3] - b[1] < 2)
      .map((b) => (b[1] + b[3]) / 2);
    const top = Math.min(...lines.filter((y) => y > anchor.spn.transform[5]));
    const bottom = Math.max(...lines.filter((y) => y < anchor.spn.transform[5]));
    if (
      !Number.isFinite(top) ||
      !Number.isFinite(bottom) ||
      top > headerY ||
      anchors.filter((a) => a.spn.transform[5] < top && a.spn.transform[5] > bottom).length !== 1
    )
      return [];
    const cells = columns.map((_, col) =>
      text
        .filter((i) => i.transform[5] < top && i.transform[5] > bottom && belongs(i, col))
        .sort((a, b) =>
          Math.abs(a.transform[5] - b.transform[5]) < 3
            ? a.transform[4] - b.transform[4]
            : b.transform[5] - a.transform[5],
        )
        .map((i) => i.str.trim())
        .join(" ")
        .replace(/\s+/g, " "),
    );
    return [
      {
        locator: `Page ${page}${printed && printed !== String(page) ? ` · printed page ${printed}` : ""} · SPN ${anchor.spn.str.trim()} / FMI ${anchor.fmi!.str.trim()}`,
        content: `SPN ${anchor.spn.str.trim()} / FMI ${anchor.fmi!.str.trim()}\n${labels.map((label, col) => `${label}: ${cells[col]}`).join("\n")}`,
      },
    ];
  });
}
