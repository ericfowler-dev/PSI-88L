import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Search, FileCheck2, ArrowUpRight } from "lucide-react";
import { api, type Source } from "@/lib/api";
import { RichText } from "./rich-text";
type Result = {
  sources: Source[];
  requestedCode: { spn: string; fmi?: string } | null;
  exactCodeMatch: boolean;
  message: string;
};
export function KnowledgeCheck({
  caseId,
  initialQuestion = "",
}: {
  caseId?: string;
  initialQuestion?: string;
}) {
  const [question, setQuestion] = useState(initialQuestion);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function search(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(
        await api<Result>("/api/knowledge/search", {
          method: "POST",
          body: JSON.stringify({ question, caseId }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <div>
        <h2 className="section-title">
          <FileCheck2 className="size-5 text-signal" /> Check your knowledge
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Search the saved evidence the AI can use. No AI request or training is needed for this
          check.
        </p>
      </div>
      <form onSubmit={search} className="flex gap-2">
        <input
          className="input"
          aria-label="Search retained knowledge"
          placeholder="Try SPN 1208 / FMI 3, a part, or a symptom"
          value={question}
          maxLength={1000}
          onChange={(e) => setQuestion(e.target.value)}
          required
        />
        <button className="btn-primary" disabled={busy || !question.trim()}>
          <Search className="size-4" />
          {busy ? "Searching…" : "Check"}
        </button>
      </form>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div role="status" className="rounded-xl border border-line bg-bg p-4">
          <p className="font-semibold">
            {result.exactCodeMatch
              ? "Exact fault-code evidence found"
              : result.sources.length
                ? "Related evidence found"
                : "No usable evidence found"}
          </p>
          <p className="mt-1 text-sm text-muted">{result.message}</p>
          {result.requestedCode && !result.exactCodeMatch && result.sources.length > 0 && (
            <p className="mt-2 text-sm text-signal">
              The SPN was found, but the requested FMI was not confirmed. Do not substitute another
              FMI.
            </p>
          )}
        </div>
      )}
      <div className="max-h-[50dvh] space-y-3 overflow-auto">
        {result?.sources.map((source, index) => (
          <article key={`${source.id}-${index}`} className="rounded-xl border border-line p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">{source.title}</p>
                <p className="mt-1 text-xs text-muted">
                  {source.locator} · revision {source.revision}
                  {source.match === "exact_code" ? " · exact code match" : ""}
                </p>
              </div>
              <Link
                to="/library"
                search={{ document: source.documentId, revision: source.revision }}
                className="inline-flex items-center gap-1 text-xs text-signal"
              >
                Open source <ArrowUpRight className="size-4" />
              </Link>
            </div>
            <div className="mt-3 text-sm text-muted">
              <RichText text={source.content} />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
