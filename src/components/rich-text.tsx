import type { ReactNode } from "react";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">");
}

function inline(value: string): ReactNode[] {
  const escaped = escapeHtml(value);
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(escaped))) {
    if (match.index > cursor) nodes.push(escaped.slice(cursor, match.index));
    if (match[2]) {
      nodes.push(
        <strong key={`${match.index}-b`} className="font-medium text-ink">
          {match[2]}
        </strong>,
      );
    } else if (match[3]) {
      nodes.push(
        <code
          key={`${match.index}-c`}
          className="rounded bg-bg px-1 py-0.5 font-mono text-sm text-signal"
        >
          {match[3]}
        </code>,
      );
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < escaped.length) nodes.push(escaped.slice(cursor));
  return nodes;
}

function isTableSep(line: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
}

export function RichText({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (line.trim().startsWith("```")) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
        code.push(lines[i] ?? "");
        i += 1;
      }
      i += 1;
      blocks.push(
        <pre
          key={i}
          className="overflow-x-auto rounded-lg bg-bg px-3 py-3 font-mono text-sm leading-6 text-ink"
        >
          {code.join("\n")}
        </pre>,
      );
      continue;
    }
    if (line.trim().startsWith("|") && isTableSep(lines[i + 1] ?? "")) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith("|")) {
        rows.push(splitRow(lines[i] ?? ""));
        i += 1;
      }
      blocks.push(
        <div key={`t-${i}`} className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr>
                {header.map((cell, index) => (
                  <th key={index} className="border-b border-line px-2 py-2 font-medium text-muted">
                    {inline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td key={index} className="border-b border-line px-2 py-2 align-top">
                      {inline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    // A streamed table header can arrive before its separator. Always advance.
    if (line.trim().startsWith("|")) {
      blocks.push(
        <p key={i} className="leading-6">
          {line}
        </p>,
      );
      i += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line.trim());
    if (heading) {
      const level = heading[1]?.length ?? 2;
      const content = inline(heading[2] ?? "");
      const className =
        level === 1
          ? "font-sans text-xl font-semibold tracking-tight"
          : level === 2
            ? "font-sans text-lg font-semibold tracking-tight"
            : "font-sans text-base font-semibold";
      const Tag = level === 1 ? "h2" : level === 2 ? "h3" : "h4";
      blocks.push(
        <Tag key={i} className={className}>
          {content}
        </Tag>,
      );
      i += 1;
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: string[] = [];
      const ordered = /^\s*\d+\.\s+/.test(line);
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*([-*]|\d+\.)\s+/, ""));
        i += 1;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List
          key={i}
          className={ordered ? "list-decimal space-y-1.5 pl-5" : "list-disc space-y-1.5 pl-5"}
        >
          {items.map((item, index) => (
            <li key={index} className="pl-1">
              {inline(item)}
            </li>
          ))}
        </List>,
      );
      continue;
    }
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() &&
      !/^(#{1,3})\s+/.test((lines[i] ?? "").trim()) &&
      !(lines[i] ?? "").trim().startsWith("```") &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i] ?? "") &&
      !(lines[i] ?? "").trim().startsWith("|")
    ) {
      paragraph.push((lines[i] ?? "").trim());
      i += 1;
    }
    blocks.push(
      <p key={i} className="text-pretty leading-6">
        {inline(paragraph.join(" "))}
      </p>,
    );
  }

  return <div className="space-y-3">{blocks}</div>;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}
