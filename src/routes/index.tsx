import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, Send, Square, Paperclip, BookOpen, Menu, X, FileText } from "lucide-react";
import { Shell } from "@/components/shell";
import { RichText } from "@/components/rich-text";
import {
  api,
  SUPPORTED,
  uploadFile,
  type KnowledgeDocument,
  type Message,
  type Source,
} from "@/lib/api";
export const Route = createFileRoute("/")({ component: Desk });
type Case = { id: string; title: string; updated_at: string };
type Status = {
  published: number;
  processing: number;
  ai: { configured: boolean; provider: string; model: string };
};
const starters = [
  "Which documents cover a no-crank condition?",
  "What do my sources say about the HT and LT coolant circuits?",
  "Review the alarm sequence in my attached log.",
  "What information is missing before diagnosing low oil pressure?",
];
function Desk() {
  const [cases, setCases] = useState<Case[]>([]);
  const [activeId, setActiveId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [attachments, setAttachments] = useState<KnowledgeDocument[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [openCases, setOpenCases] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const selectedCase = useRef("");
  const caseLoad = useRef(0);
  const submitting = useRef(false);
  selectedCase.current = activeId;
  async function loadCases() {
    const result = await api<{ cases: Case[] }>("/api/cases");
    setCases(result.cases);
    return result.cases;
  }
  async function loadCase(id: string) {
    const version = ++caseLoad.current;
    const result = await api<{ messages: Message[]; attachments: KnowledgeDocument[] }>(
      `/api/cases/${id}`,
    );
    if (selectedCase.current !== id || version !== caseLoad.current) return;
    setMessages(result.messages);
    setAttachments(result.attachments);
  }
  async function newCase() {
    if (busy) return;
    const item = await api<Case>("/api/cases", { method: "POST" });
    setCases((old) => [item, ...old]);
    selectedCase.current = item.id;
    setActiveId(item.id);
    setQuestion("");
    setOpenCases(false);
    return item.id;
  }
  useEffect(() => {
    void Promise.all([loadCases(), api<Status>("/api/status")])
      .then(([items, s]) => {
        setStatus(s);
        if (items[0]) setActiveId(items[0].id);
      })
      .catch((e) => setError(e.message));
    return () => abort.current?.abort();
  }, []);
  useEffect(() => {
    setMessages([]);
    setAttachments([]);
    setError("");
    if (activeId) void loadCase(activeId).catch((e) => setError(e.message));
  }, [activeId]);
  useEffect(() => {
    if (
      (!attachments.some((d) => ["queued", "processing"].includes(d.status)) &&
        !messages.some((m) => m.status === "pending")) ||
      !activeId ||
      busy
    )
      return;
    const timer = setInterval(() => {
      void loadCase(activeId).catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [attachments, messages, activeId, busy]);
  useEffect(() => {
    if (scroller.current && messages.length)
      scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages]);
  async function attach(files: FileList) {
    setUploading(true);
    setError("");
    try {
      let id = activeId;
      if (!id) id = (await newCase()) || "";
      for (const file of Array.from(files).slice(0, 5)) await uploadFile(file, id);
      await loadCase(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (uploadInput.current) uploadInput.current.value = "";
    }
  }
  async function ask(value: string) {
    if (!value.trim() || busy || submitting.current || uploading || !status?.ai.configured) return;
    submitting.current = true;
    setError("");
    let id = activeId;
    let assistantId = "";
    try {
      if (!id) id = (await newCase()) || "";
      setBusy(true);
      setQuestion("");
      const controller = new AbortController();
      abort.current = controller;
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: id, question: value }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const result = await response.json();
        throw new Error(result.error || "Unable to answer.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value: chunk, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const data = buffer
            .slice(0, end)
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5))
            .join("\n");
          buffer = buffer.slice(end + 2);
          if (!data.trim()) continue;
          const event = JSON.parse(data) as {
            type: string;
            userId: string;
            assistantId: string;
            sources: Source[];
            text: string;
            error: string;
            status: string;
          };
          if (event.type === "start") {
            assistantId = event.assistantId;
            setMessages((old) => [
              ...old,
              { id: event.userId, role: "user", content: value, sources: [], status: "complete" },
              {
                id: assistantId,
                role: "assistant",
                content: "",
                sources: event.sources,
                status: "pending",
              },
            ]);
          }
          if (event.type === "delta")
            setMessages((old) =>
              old.map((m) =>
                m.id === assistantId ? { ...m, content: m.content + event.text } : m,
              ),
            );
          if (event.type === "error") setError(event.error);
          if (event.type === "done")
            setMessages((old) =>
              old.map((m) => (m.id === assistantId ? { ...m, status: event.status } : m)),
            );
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      submitting.current = false;
      abort.current = null;
      setBusy(false);
      if (id) {
        await loadCase(id).catch(() => {});
        await loadCases().catch(() => {});
      }
    }
  }
  const sourceMessage = [...messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.sources?.length);
  const caseList = (
    <>
      <button
        disabled={busy}
        className="btn-secondary m-3"
        onClick={() => void newCase().catch((e) => setError(e.message))}
      >
        <Plus className="size-4" /> New case
      </button>
      <p className="px-4 py-2 font-mono text-xs text-faint">SAVED CASES</p>
      <div className="flex-1 overflow-y-auto px-2">
        {cases.map((item) => (
          <button
            disabled={busy}
            key={item.id}
            onClick={() => {
              setActiveId(item.id);
              setOpenCases(false);
            }}
            className={`mb-1 min-h-11 w-full rounded-lg px-3 py-3 text-left text-sm leading-5 ${activeId === item.id ? "bg-raised" : "hover:bg-raised"}`}
          >
            {item.title}
          </button>
        ))}
        {!cases.length && (
          <p className="p-3 text-sm leading-6 text-muted">
            Start a question to create your first retained case.
          </p>
        )}
      </div>
      <p className="border-t border-line p-4 text-xs leading-5 text-faint">
        Cases and attachments are private to your account and saved across devices.
      </p>
    </>
  );
  return (
    <Shell section="desk" lock>
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-panel lg:flex">
          {caseList}
        </aside>
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-14 items-center gap-3 border-b border-line px-4">
            <button
              className="btn-icon lg:hidden"
              aria-label="Open cases"
              onClick={() => setOpenCases(true)}
            >
              <Menu className="size-5" />
            </button>
            <span className="truncate text-sm text-muted">
              {cases.find((c) => c.id === activeId)?.title || "Technical desk"}
            </span>
            <span className="badge ml-auto shrink-0">
              {status?.published || 0} published sources
            </span>
          </div>
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
            <div className="mx-auto max-w-3xl space-y-7">
              {!messages.length ? (
                <div className="py-5 sm:py-10">
                  <p className="eyebrow">EVIDENCE BEFORE ANSWERS</p>
                  <h1 className="mt-3 max-w-xl text-3xl font-semibold tracking-tight sm:text-4xl">
                    Technical support, grounded in your knowledge.
                  </h1>
                  <p className="mt-4 max-w-xl text-base leading-7 text-muted">
                    Ask about the PSI 88L diesel using your manuals, field notes, and case evidence.
                    Every source stays in your workspace.
                  </p>
                  <div className="surface mt-7 p-5">
                    <div className="flex items-start gap-3">
                      <BookOpen className="mt-1 size-5 shrink-0 text-signal" />
                      <div>
                        <h2 className="font-medium">
                          {status?.published
                            ? "Your library is ready to reference."
                            : "Start by building your library."}
                        </h2>
                        <p className="mt-2 text-sm leading-6 text-muted">
                          Upload a manual or write a technical note. Review and publish it to make
                          its content available to future answers.
                        </p>
                        <Link
                          to="/library"
                          search={{ document: "", revision: undefined }}
                          className="mt-3 inline-flex min-h-11 items-center text-sm text-signal"
                        >
                          Open knowledge library →
                        </Link>
                      </div>
                    </div>
                  </div>
                  <div className="mt-5 grid gap-2 sm:grid-cols-2">
                    {starters.map((starter) => (
                      <button
                        className="rounded-lg border border-line p-4 text-left text-sm leading-6 text-muted hover:border-faint"
                        key={starter}
                        onClick={() => setQuestion(starter)}
                      >
                        {starter}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((message) => (
                  <article
                    key={message.id}
                    className={
                      message.role === "user"
                        ? "ml-auto max-w-xl rounded-card bg-raised px-4 py-3"
                        : "border-l-2 border-signal pl-4"
                    }
                  >
                    {message.role === "user" ? (
                      <p className="whitespace-pre-wrap leading-6">{message.content}</p>
                    ) : (
                      <>
                        <p className="eyebrow mb-3">
                          PSI-88L DESK{message.status === "error" ? " · INCOMPLETE" : ""}
                        </p>
                        {message.content ? (
                          <RichText text={message.content} />
                        ) : (
                          <p className="text-sm text-muted">
                            Searching your evidence and preparing an answer…
                          </p>
                        )}
                        {!!message.sources?.length && (
                          <div className="mt-4 flex flex-wrap gap-2">
                            {message.sources.map((source, index) => (
                              <Link
                                key={`${source.id}-${index}`}
                                to="/library"
                                search={{ document: source.documentId, revision: source.revision }}
                                className="rounded-lg border border-line px-3 py-2 text-xs leading-5 text-muted hover:text-ink"
                              >
                                [S{index + 1}] {source.title} · {source.locator}
                              </Link>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </article>
                ))
              )}
            </div>
          </div>
          <div className="border-t border-line px-4 py-3 sm:px-6">
            <div className="mx-auto max-w-3xl">
              {error && (
                <p role="alert" className="error-box">
                  {error}
                </p>
              )}
              {status && !status.ai.configured && (
                <p className="mb-3 text-xs leading-5 text-muted">
                  AI is not connected yet. An administrator can configure the provider in Settings.
                  You can build the knowledge library now.
                </p>
              )}
              {!!attachments.length && (
                <div className="mb-3 flex max-h-28 flex-wrap gap-2 overflow-y-auto">
                  {attachments.map((file) => (
                    <Link
                      key={file.id}
                      to="/library"
                      search={{ document: file.id, revision: undefined }}
                      className="badge gap-1"
                    >
                      <FileText className="size-3" />
                      <span className="max-w-48 truncate">{file.filename}</span>
                      <span>· {file.status === "review" ? "Ready for case" : file.status}</span>
                    </Link>
                  ))}
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask(question);
                }}
                className="rounded-card border border-line bg-panel p-2"
              >
                <label className="sr-only" htmlFor="question">
                  Question for the desk
                </label>
                <textarea
                  id="question"
                  rows={2}
                  maxLength={8000}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Describe the symptom, alarm, or information you need…"
                  className="w-full resize-none bg-transparent px-3 py-2 text-base leading-6 outline-none placeholder:text-faint"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void ask(question);
                    }
                  }}
                />
                <div className="flex items-center justify-between gap-3">
                  <button
                    disabled={busy || uploading}
                    type="button"
                    className="btn-icon"
                    title="Attach case evidence"
                    aria-label="Attach files to case"
                    onClick={() => uploadInput.current?.click()}
                  >
                    <Paperclip className="size-5" />
                  </button>
                  <input
                    ref={uploadInput}
                    type="file"
                    multiple
                    accept={SUPPORTED}
                    className="hidden"
                    onChange={(e) => e.target.files && void attach(e.target.files)}
                    aria-label="Case attachment files"
                  />
                  <span className="mr-auto text-xs text-faint">
                    {uploading ? "Retaining attachments…" : "PDFs, logs, photos & text"}
                  </span>
                  {busy ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => abort.current?.abort()}
                    >
                      <Square className="size-4" /> Stop
                    </button>
                  ) : (
                    <button
                      disabled={!question.trim() || uploading || !status?.ai.configured}
                      className="btn-primary"
                    >
                      <Send className="size-4" /> Ask
                    </button>
                  )}
                </div>
              </form>
              <p className="mt-2 text-xs leading-5 text-faint">
                Verify technical guidance against the current service publication and approved site
                procedures.
              </p>
            </div>
          </div>
        </section>
        <aside className="hidden w-64 shrink-0 flex-col overflow-y-auto border-l border-line bg-panel p-5 xl:flex">
          <p className="eyebrow">EVIDENCE IN CONTEXT</p>
          <h2 className="mt-4 font-medium">Retrieved sources</h2>
          <p className="mt-2 text-xs leading-5 text-muted">
            Passages supplied to the latest answer. Follow the answer’s citations to inspect its
            evidence.
          </p>
          <div className="mt-5 space-y-3">
            {sourceMessage?.sources.map((source, index) => (
              <Link
                key={`${source.id}-${index}`}
                to="/library"
                search={{ document: source.documentId, revision: source.revision }}
                className="block rounded-lg border border-line p-3"
              >
                <p className="font-mono text-xs text-signal">
                  S{index + 1} · REVISION {source.revision}
                </p>
                <p className="mt-2 text-sm">{source.title}</p>
                <p className="mt-2 text-xs text-muted">{source.locator}</p>
              </Link>
            )) || (
              <p className="text-sm leading-6 text-faint">
                Source references appear here when a question retrieves evidence.
              </p>
            )}
          </div>
          <div className="mt-auto border-t border-line pt-5 text-xs leading-5 text-muted">
            Published library knowledge is shared. Your case attachments remain private.
          </div>
        </aside>
      </div>
      {openCases && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Saved cases"
          className="fixed inset-0 z-30 bg-bg lg:hidden"
        >
          <div className="flex h-full flex-col">
            <div className="flex justify-end p-2">
              <button
                className="btn-icon"
                aria-label="Close cases"
                onClick={() => setOpenCases(false)}
              >
                <X className="size-5" />
              </button>
            </div>
            {caseList}
          </div>
        </div>
      )}
    </Shell>
  );
}
