import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Upload,
  Plus,
  Search,
  FileText,
  Download,
  RefreshCw,
  Trash2,
  CheckCircle2,
} from "lucide-react";
import { Shell } from "@/components/shell";
import { useSession } from "@/components/session";
import { api, bytes, changed, SUPPORTED, uploadFile, type KnowledgeDocument } from "@/lib/api";
import { RichText } from "@/components/rich-text";
import { KnowledgeCheck } from "@/components/knowledge-check";
export const Route = createFileRoute("/library")({
  validateSearch: (search: Record<string, unknown>) => ({
    document: typeof search.document === "string" ? search.document : "",
    revision: Number(search.revision) > 0 ? Number(search.revision) : undefined,
  }),
  component: Library,
});
type Detail = {
  document: KnowledgeDocument;
  revision: number;
  chunks: { id: string; locator: string; content: string }[];
};
function Library() {
  const { user } = useSession();
  const canEdit = user.role !== "reader";
  const search = Route.useSearch();
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [selected, setSelected] = useState(search.document);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [newNote, setNewNote] = useState(false);
  const [note, setNote] = useState({ title: "", sourceNote: "", content: "" });
  const [editing, setEditing] = useState(false);
  const [visiblePassages, setVisiblePassages] = useState(50);
  const [passageQuery, setPassageQuery] = useState("");
  const [confirmReprocess, setConfirmReprocess] = useState(false);
  const [reviewedText, setReviewedText] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef(selected);
  const loadVersion = useRef(0);
  const refreshVersion = useRef(0);
  selectedRef.current = selected;
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    const value = await api<{ documents: KnowledgeDocument[] }>(
      `/api/knowledge?q=${encodeURIComponent(query)}`,
    );
    if (version !== refreshVersion.current) return;
    setDocuments(value.documents);
    setLoading(false);
  }, [query]);
  const load = useCallback(
    async (id: string) => {
      const version = ++loadVersion.current;
      const value = await api<Detail>(
        `/api/knowledge/${id}${search.revision && id === search.document ? `?revision=${search.revision}` : ""}`,
      );
      if (selectedRef.current !== id || version !== loadVersion.current) return;
      setDetail(value);
      setAcknowledged(false);
      setConfirmDelete(false);
    },
    [search.document, search.revision],
  );
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      if (live)
        void refresh().catch((e) => {
          setError(e.message);
          setLoading(false);
        });
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (search.document) {
      setSelected(search.document);
      setNewNote(false);
    }
  }, [search.document]);
  useEffect(() => {
    setEditing(false);
    setVisiblePassages(50);
    setPassageQuery("");
    setConfirmReprocess(false);
    setDetail(null);
    if (selected) void load(selected).catch((e) => setError(e.message));
  }, [selected, load]);
  useEffect(() => {
    if (
      !documents.some((d) => ["queued", "processing"].includes(d.status)) &&
      !["queued", "processing"].includes(detail?.document.status || "")
    )
      return;
    const timer = setInterval(() => {
      void refresh().catch(() => {});
      if (selected && !editing) void load(selected).catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [documents, detail?.document.status, selected, editing, refresh, load]);
  async function upload(files: FileList | File[]) {
    if (!canEdit) return;
    setBusy(true);
    setError("");
    setNotice("");
    let last = "";
    let duplicates = 0;
    try {
      for (const file of Array.from(files).slice(0, 5)) {
        const result = await uploadFile(file);
        last = result.document.id;
        if (result.duplicate) duplicates++;
      }
      await refresh();
      if (last) setSelected(last);
      setNewNote(false);
      changed();
      setNotice(
        duplicates
          ? `${duplicates} existing file(s) reused. New files are queued for processing.`
          : "Files retained. Processing will continue in the background.",
      );
    } catch (e) {
      setError((e as Error).message);
      await refresh();
    } finally {
      setBusy(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  }
  async function createNote(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ document: KnowledgeDocument }>("/api/knowledge/text", {
        method: "POST",
        body: JSON.stringify(note),
      });
      setNewNote(false);
      setSelected(result.document.id);
      setNote({ title: "", sourceNote: "", content: "" });
      await refresh();
      changed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function update(publish: boolean) {
    if (!detail) return;
    if (editing && (!reviewedText.trim() || reviewedText.length > 500_000)) {
      setError("Enter reviewed text before saving (up to 500,000 characters).");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(`/api/knowledge/${detail.document.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          revision: detail.document.revision,
          ...(editing ? { content: reviewedText } : {}),
          publish,
          acknowledged,
        }),
      });
      setEditing(false);
      await load(detail.document.id);
      await refresh();
      changed();
      setNotice(
        publish
          ? "Published. Future answers can retrieve this source."
          : "Saved for review. It is not available to shared-library answers.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!detail) return;
    setBusy(true);
    try {
      const result = await api<{ cleanupPending: boolean }>(
        `/api/knowledge/${detail.document.id}`,
        { method: "DELETE" },
      );
      setSelected("");
      setDetail(null);
      await refresh();
      changed();
      setNotice(
        result.cleanupPending
          ? "Source removed from retrieval. Original-file cleanup is queued for retry. Existing answers retain their historical excerpts."
          : "Source removed from retrieval and original storage. Existing case answers retain their historical excerpts.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function analyzeImage() {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/knowledge/${detail.document.id}/analyze-image`, { method: "POST" });
      await load(detail.document.id);
      await refresh();
      changed();
      setNotice(
        "AI draft description added as a new revision. Review it against the photo before publication.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const doc = detail?.document;
  const filteredPassages =
    detail?.chunks.filter((chunk) =>
      passageQuery
        .toLowerCase()
        .trim()
        .split(/\s+/)
        .every((term) => `${chunk.locator} ${chunk.content}`.toLowerCase().includes(term)),
    ) || [];
  const canReplaceText =
    (detail?.chunks.reduce((size, chunk) => size + chunk.content.length + 2, 0) || 0) <= 500_000;
  const invalidReview = editing && (!reviewedText.trim() || reviewedText.length > 500_000);
  return (
    <Shell section="library">
      <main className="page-wrap">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">RETAINED KNOWLEDGE</p>
            <h1 className="page-title">Your source library</h1>
            <p className="page-description">
              Build the evidence behind every answer. Upload, review, and publish once; use it
              across future cases.
            </p>
          </div>
          {canEdit && (
            <div className="flex gap-2">
              <button
                className="btn-secondary"
                onClick={() => {
                  setNewNote(true);
                  setSelected("");
                  setDetail(null);
                  setError("");
                }}
              >
                <Plus className="size-4" /> Write a note
              </button>
              <button
                disabled={busy}
                className="btn-primary"
                onClick={() => uploadRef.current?.click()}
              >
                <Upload className="size-4" /> {busy ? "Working…" : "Upload files"}
              </button>
              <input
                className="hidden"
                ref={uploadRef}
                type="file"
                multiple
                accept={SUPPORTED}
                onChange={(e) => e.target.files && void upload(e.target.files)}
                aria-label="Upload library files"
              />
            </div>
          )}
        </div>
        {error && (
          <p role="alert" className="error-box">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="notice-box">
            {notice}
          </p>
        )}
        <details className="surface mb-5 p-4 sm:p-5">
          <summary className="cursor-pointer text-sm font-semibold text-signal">
            Verify what the AI can find in your knowledge
          </summary>
          <div className="mt-4">
            <KnowledgeCheck />
          </div>
        </details>
        <div className="grid items-start gap-5 lg:grid-cols-3">
          <aside className="surface overflow-hidden">
            <div className="border-b border-line p-4">
              <label className="flex items-center gap-2">
                <Search className="size-4 shrink-0 text-muted" />
                <input
                  className="input"
                  aria-label="Search source titles"
                  placeholder="Find a source…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <p className="mt-3 text-xs text-muted">
                {documents.length} source{documents.length === 1 ? "" : "s"} ·{" "}
                {documents.filter((d) => d.status === "published").length} published
              </p>
            </div>
            <div className="max-h-96 overflow-y-auto lg:max-h-none">
              {documents.map((d) => (
                <button
                  key={d.id}
                  className={`flex w-full flex-col gap-2 border-b border-line p-4 text-left hover:bg-raised ${selected === d.id && !newNote ? "bg-raised" : ""}`}
                  onClick={() => {
                    setSelected(d.id);
                    setNewNote(false);
                    setError("");
                    setNotice("");
                  }}
                >
                  <span className="flex items-start gap-2">
                    <FileText className="mt-0.5 size-4 shrink-0 text-signal" />
                    <span className="break-words text-sm font-medium">{d.title}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={`badge ${d.status === "published" ? "text-signal" : ""}`}>
                      {d.status === "review" ? "Needs review" : d.status}
                    </span>
                    <span className="text-xs text-faint">
                      {bytes(d.byte_size)} · {d.total_pages > 0 ? `${d.total_pages} pages · ` : ""}r
                      {d.revision}
                    </span>
                  </span>
                </button>
              ))}
              {!documents.length && (
                <p className="p-6 text-sm leading-6 text-muted">
                  {loading
                    ? "Loading sources…"
                    : query
                      ? "No sources match this title."
                      : "Your library is empty. Add your first manual, log, or technical note."}
                </p>
              )}
            </div>
          </aside>
          <section className="min-w-0 lg:col-span-2">
            {newNote ? (
              <form className="surface space-y-5 p-5 sm:p-7" onSubmit={createNote}>
                <h2 className="section-title">Add a technical note</h2>
                <label className="field-label">
                  Title
                  <input
                    required
                    maxLength={200}
                    value={note.title}
                    onChange={(e) => setNote({ ...note, title: e.target.value })}
                  />
                </label>
                <label className="field-label">
                  Source / applicability
                  <input
                    placeholder="Manual revision, engine serial range, or reviewed field observation"
                    value={note.sourceNote}
                    onChange={(e) => setNote({ ...note, sourceNote: e.target.value })}
                  />
                </label>
                <label className="field-label">
                  Knowledge text
                  <textarea
                    required
                    rows={12}
                    placeholder="Paste the technical material you want the assistant to reference…"
                    value={note.content}
                    onChange={(e) => setNote({ ...note, content: e.target.value })}
                  />
                </label>
                <div className="flex gap-2">
                  <button disabled={busy} className="btn-primary">
                    Save for review
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => setNewNote(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : detail && doc ? (
              <div className="surface p-5 sm:p-7">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="eyebrow">SOURCE · REVISION {detail.revision}</p>
                    <h2 className="mt-2 break-words text-xl font-semibold">{doc.title}</h2>
                    <p className="mt-2 break-all text-xs text-muted">
                      {doc.filename} · {bytes(doc.byte_size)}
                    </p>
                  </div>
                  <a
                    className="btn-icon"
                    href={`/api/knowledge/${doc.id}/download`}
                    aria-label="Download original"
                    title="Download original"
                  >
                    <Download className="size-5" />
                  </a>
                </div>
                <p className="mt-4 text-sm text-muted">{doc.source_note}</p>
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-line bg-bg p-3">
                    <p className="text-xs text-muted">Original PDF</p>
                    <p className="mt-1 text-lg font-semibold">
                      {doc.total_pages > 0
                        ? `${doc.total_pages} pages`
                        : doc.media_type === "application/pdf"
                          ? "Page count pending"
                          : "File retained"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-line bg-bg p-3">
                    <p className="text-xs text-muted">Searchable sections</p>
                    <p className="mt-1 text-lg font-semibold">{detail.chunks.length} passages</p>
                  </div>
                  <div className="col-span-2 rounded-xl border border-line bg-bg p-3 sm:col-span-1">
                    <p className="text-xs text-muted">AI availability</p>
                    <p
                      className={`mt-1 text-sm font-semibold ${doc.status === "published" ? "text-signal" : ""}`}
                    >
                      {doc.status === "published"
                        ? "Published · available"
                        : doc.case_id && doc.status === "review"
                          ? "Ready for this case"
                          : doc.status === "review"
                            ? "Needs review & publication"
                            : doc.status}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-5 text-muted">
                  Passages are sections of text, not pages. One page can produce several passages.
                  The original document stays intact.
                </p>
                {doc.media_type === "application/pdf" && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <a
                      className="btn-secondary"
                      href={`/api/knowledge/${doc.id}/preview`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open original PDF
                    </a>
                    {canEdit && !["queued", "processing"].includes(doc.status) && (
                      <button
                        className="btn-secondary"
                        onClick={() => setConfirmReprocess(!confirmReprocess)}
                      >
                        Re-extract original
                      </button>
                    )}
                  </div>
                )}
                {confirmReprocess && (
                  <div className="notice-box mt-3">
                    <p>
                      Create a fresh extraction with page references and diagnostic table rows? Your
                      original and previous revisions are retained. This source will need review and
                      publication again.
                    </p>
                    <button
                      className="btn-primary mt-3"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError("");
                        try {
                          await api(`/api/knowledge/${doc.id}/reprocess`, { method: "POST" });
                          setConfirmReprocess(false);
                          setEditing(false);
                          await load(doc.id);
                          await refresh();
                          changed();
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Start new extraction
                    </button>
                  </div>
                )}
                {doc.case_id && (
                  <p className="notice-box mt-4">
                    Private case attachment. This is not shared library knowledge.
                  </p>
                )}
                {doc.media_type.startsWith("image/") && (
                  <div className="mt-5">
                    <img
                      src={`/api/knowledge/${doc.id}/preview`}
                      alt={`Original source: ${doc.title}`}
                      className="max-h-80 w-full rounded-lg border border-line object-contain"
                    />
                    {(canEdit || doc.case_id) && ["review", "published"].includes(doc.status) && (
                      <div className="mt-3">
                        <button
                          className="btn-secondary"
                          disabled={busy}
                          onClick={() => void analyzeImage()}
                        >
                          {busy ? "Analyzing…" : "Analyze image with AI"}
                        </button>
                        <p className="mt-2 text-xs leading-5 text-muted">
                          Uses your configured vision-capable model. The description remains an
                          unverified draft until reviewed.
                        </p>
                      </div>
                    )}
                  </div>
                )}
                {detail.revision !== doc.revision && (
                  <p className="notice-box mt-4">
                    Viewing a historical revision used in an earlier answer. Current revision:{" "}
                    {doc.revision}.
                  </p>
                )}
                {["queued", "processing"].includes(doc.status) && (
                  <p role="status" className="notice-box mt-5">
                    {doc.status === "queued" ? "Queued for extraction." : "Reading this source…"}{" "}
                    {doc.total_pages > 0 &&
                      `Processed ${doc.processed_pages} of ${doc.total_pages} pages. `}
                    You can leave this page; the original is retained.
                  </p>
                )}
                {doc.error && (
                  <div className="error-box mt-5">
                    <p>{doc.error}</p>
                    {canEdit && (
                      <button
                        disabled={busy}
                        className="btn-secondary mt-3"
                        onClick={() => {
                          setError("");
                          setEditing(false);
                          void api(`/api/knowledge/${doc.id}/retry`, { method: "POST" })
                            .then(() => load(doc.id))
                            .catch((e) => setError(e.message));
                        }}
                      >
                        <RefreshCw className="size-4" /> Retry processing
                      </button>
                    )}
                  </div>
                )}
                {!!doc.warnings.length && (
                  <div className="mt-5 rounded-lg border border-line bg-bg p-4">
                    <p className="text-sm font-medium">Review notes</p>
                    <ul className="mt-2 list-disc space-y-2 pl-4 text-xs leading-5 text-muted">
                      {doc.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-5">
                  <h3 className="text-sm font-medium">
                    Extracted evidence · {detail.chunks.length} passages
                  </h3>
                  {canEdit &&
                    !["queued", "processing", "failed"].includes(doc.status) &&
                    canReplaceText &&
                    detail.revision === doc.revision && (
                      <button
                        className="btn-secondary"
                        onClick={() => {
                          setEditing(!editing);
                          setReviewedText(detail.chunks.map((c) => c.content).join("\n\n"));
                        }}
                      >
                        {editing ? "Cancel edit" : "Correct / add text"}
                      </button>
                    )}
                </div>
                {!canReplaceText && (
                  <p className="mt-3 text-xs text-muted">
                    Full manual retained. Whole-document text editing is limited to 500,000
                    characters; this does not limit the knowledge available to search. Use a
                    separate note for corrections.
                  </p>
                )}
                {!editing && (
                  <input
                    className="input mt-4"
                    aria-label="Search within this source"
                    placeholder="Find text or a page in this source, e.g. 1208"
                    value={passageQuery}
                    onChange={(e) => {
                      setPassageQuery(e.target.value);
                      setVisiblePassages(50);
                    }}
                  />
                )}
                {passageQuery && (
                  <p className="mt-2 text-xs text-muted">
                    {filteredPassages.length} matching passages in this revision
                  </p>
                )}
                {editing ? (
                  <label className="field-label mt-4">
                    Reviewed transcription
                    <textarea
                      rows={15}
                      maxLength={500_000}
                      className="font-mono text-sm"
                      value={reviewedText}
                      onChange={(e) => setReviewedText(e.target.value)}
                    />
                    <span className="text-xs">
                      Saving creates a new revision. Original file and previous text revisions are
                      retained.
                    </span>
                  </label>
                ) : (
                  <div className="mt-4 max-h-96 space-y-5 overflow-y-auto pr-2">
                    {filteredPassages.slice(0, visiblePassages).map((c) => (
                      <article key={c.id} className="rounded-lg border border-line bg-bg p-4">
                        <p className="mb-3 font-mono text-xs text-signal">{c.locator}</p>
                        {doc.media_type === "application/pdf" && /^Page \d+/.test(c.locator) && (
                          <a
                            className="mb-3 inline-block text-xs text-signal underline"
                            target="_blank"
                            rel="noreferrer"
                            href={`/api/knowledge/${doc.id}/preview#page=${/^Page (\d+)/.exec(c.locator)![1]}`}
                          >
                            Open this PDF page
                          </a>
                        )}
                        <div className="text-sm text-muted">
                          <RichText text={c.content} />
                        </div>
                      </article>
                    ))}
                    {filteredPassages.length > visiblePassages && (
                      <button
                        className="btn-secondary"
                        onClick={() => setVisiblePassages((count) => count + 50)}
                      >
                        Show more passages ({visiblePassages} of {filteredPassages.length})
                      </button>
                    )}
                    {!detail.chunks.length && !["queued", "processing"].includes(doc.status) && (
                      <p className="text-sm text-muted">
                        {doc.status === "failed"
                          ? "Processing did not finish. Retry the retained original; no re-upload is needed."
                          : "No text extracted. Add a transcription or a reviewed description to make this source searchable."}
                      </p>
                    )}
                  </div>
                )}
                {canEdit &&
                  !["queued", "processing"].includes(doc.status) &&
                  detail.revision === doc.revision && (
                    <div className="mt-6 space-y-4 border-t border-line pt-5">
                      {!doc.case_id && (
                        <label className="flex min-h-11 items-start gap-3 text-sm leading-6 text-muted">
                          <input
                            type="checkbox"
                            className="mt-1 size-4 shrink-0 accent-signal"
                            checked={acknowledged}
                            onChange={(e) => setAcknowledged(e.target.checked)}
                          />
                          I reviewed the source, technical values, applicability, and extraction
                          warnings.
                        </label>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {!doc.case_id && (
                          <button
                            disabled={
                              busy ||
                              !acknowledged ||
                              invalidReview ||
                              doc.status === "failed" ||
                              (!editing && !detail.chunks.length)
                            }
                            className="btn-primary"
                            onClick={() => void update(true)}
                          >
                            <CheckCircle2 className="size-4" /> Publish knowledge
                          </button>
                        )}
                        <button
                          disabled={busy || invalidReview || doc.status === "failed"}
                          className="btn-secondary"
                          onClick={() => void update(false)}
                        >
                          {editing
                            ? "Save revision for review"
                            : doc.status === "published"
                              ? "Unpublish"
                              : "Save for review"}
                        </button>
                        <button
                          disabled={busy}
                          className="btn-icon ml-auto"
                          aria-label="Delete source"
                          onClick={() => setConfirmDelete(true)}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                      {confirmDelete && (
                        <div className="error-box">
                          <p>
                            Remove this source, its original file, and searchable passages? Existing
                            case answers retain their historical excerpts.
                          </p>
                          <div className="mt-3 flex gap-2">
                            <button
                              className="btn-secondary"
                              disabled={busy}
                              onClick={() => void remove()}
                            >
                              Confirm removal
                            </button>
                            <button
                              className="btn-secondary"
                              onClick={() => setConfirmDelete(false)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
              </div>
            ) : (
              <div
                className="surface flex min-h-96 flex-col items-center justify-center p-8 text-center"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (canEdit && !busy) void upload(e.dataTransfer.files);
                }}
              >
                <Upload className="size-10 text-signal" />
                <h2 className="mt-5 text-2xl font-semibold">Give the desk your knowledge.</h2>
                <p className="mt-3 max-w-md text-sm leading-6 text-muted">
                  Manuals, service bulletins, event logs, photos, or your own field notes. Sources
                  are retained and reviewed before they inform shared-library answers.
                </p>
                <p className="mt-4 max-w-md font-mono text-xs leading-6 text-faint">
                  PDF · TXT · LOG · DOCX · CSV · JSON · PHOTOS
                  <br />
                  Up to 20 MB per file · 5 files per upload
                </p>
                {canEdit && (
                  <button
                    className="btn-primary mt-6"
                    disabled={busy}
                    onClick={() => uploadRef.current?.click()}
                  >
                    Choose files or drop them here
                  </button>
                )}
                <Link className="mt-5 text-sm text-muted underline" to="/">
                  Return to the Desk
                </Link>
              </div>
            )}
          </section>
        </div>
      </main>
    </Shell>
  );
}
