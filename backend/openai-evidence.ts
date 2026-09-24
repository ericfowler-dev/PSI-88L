import type { Source } from "./knowledge.ts";

type Annotation = { type?: string; file_id?: string; filename?: string; index?: number };
type OutputItem = {
  type?: string;
  status?: string;
  results?: { file_id?: string; filename?: string; text?: string }[];
  content?: { type?: string; text?: string; annotations?: Annotation[] }[];
};

// Provider annotations establish citations; model-written file names alone do not.
export class OpenAIFileEvidence {
  private citations = new Map<string, { filename: string; label: string }>();
  private excerpts = new Map<string, Set<string>>();
  addAnnotation(annotation: Annotation) {
    if (annotation?.type !== "file_citation" || typeof annotation.file_id !== "string") return;
    if (this.citations.has(annotation.file_id) || this.citations.size >= 40) return;
    this.citations.set(annotation.file_id, {
      filename:
        typeof annotation.filename === "string"
          ? annotation.filename.slice(0, 300)
          : annotation.file_id,
      label: `F${this.citations.size + 1}`,
    });
  }
  addItem(item: OutputItem) {
    if (item?.type === "file_search_call") {
      if (item.status === "failed")
        throw new Error(
          "OpenAI file search failed. Check vector store access and processing status in Settings.",
        );
      for (const result of item.results || []) {
        if (typeof result.file_id !== "string" || typeof result.text !== "string") continue;
        if (!this.excerpts.has(result.file_id) && this.excerpts.size >= 40) continue;
        const texts = this.excerpts.get(result.file_id) || new Set<string>();
        if (texts.size < 8) texts.add(result.text.slice(0, 6000));
        this.excerpts.set(result.file_id, texts);
      }
    }
    if (item?.type === "message")
      for (const part of item.content || [])
        for (const annotation of part.annotations || []) this.addAnnotation(annotation);
  }
  sources(): Source[] {
    return [...this.citations].map(([fileId, citation]) => ({
      id: `openai:${fileId}`,
      documentId: "",
      title: citation.filename,
      filename: citation.filename,
      revision: 0,
      locator: "OpenAI file search · retained answer evidence",
      content:
        [...(this.excerpts.get(fileId) || [])].join("\n\n").slice(0, 12000) ||
        "OpenAI cited this file but did not return a text excerpt. Review the original in your OpenAI project.",
      citation: citation.label,
      external: { provider: "openai", fileId },
    }));
  }
  finalText(output: OutputItem[]): string | undefined {
    for (const item of output) this.addItem(item);
    const parts: string[] = [];
    for (const item of output) {
      if (item.type !== "message") continue;
      for (const part of item.content || []) {
        if (part.type !== "output_text" || typeof part.text !== "string") continue;
        let text = part.text;
        const inserts = new Map<number, Set<string>>();
        for (const annotation of part.annotations || []) {
          const label = annotation.file_id && this.citations.get(annotation.file_id)?.label;
          if (annotation.type !== "file_citation" || !label) continue;
          const index =
            Number.isInteger(annotation.index) &&
            annotation.index! >= 0 &&
            annotation.index! <= text.length
              ? annotation.index!
              : text.length;
          const labels = inserts.get(index) || new Set<string>();
          labels.add(label);
          inserts.set(index, labels);
        }
        for (const [index, labels] of [...inserts].sort((a, b) => b[0] - a[0]))
          text = `${text.slice(0, index)} ${[...labels].map((label) => `[${label}]`).join(" ")}${text.slice(index)}`;
        parts.push(text.replace(/filecite[^]*/g, ""));
      }
    }
    return parts.length ? parts.join("\n\n") : undefined;
  }
}
