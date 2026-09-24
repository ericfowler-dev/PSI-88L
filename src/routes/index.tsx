import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Plus,
  Send,
  Square,
  Paperclip,
  BookOpen,
  Menu,
  X,
  FileText,
  SearchCheck,
} from "lucide-react";
import { Shell } from "@/components/shell";
import { RichText } from "@/components/rich-text";
import { KnowledgeCheck } from "@/components/knowledge-check";
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
  const [openCheck, setOpenCheck] = useState(false);
  const checkDialog = useRef<HTMLDialogElement>(null);
  const questionInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (openCheck) checkDialog.current?.showModal();
    else checkDialog.current?.close();
  }, [openCheck]);
  useEffect(() => {
    const input = questionInput.current;
    if (input) {
      input.style.height = "44px";
      input.style.height = `${Math.min(144, Math.max(44, input.scrollHeight))}px`;
    }
  }, [question]);
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
          if (event.type === "sources")
            setMessages((old) =>
              old.map((m) => (m.id === assistantId ? { ...m, sources: event.sources } : m)),
            );
          if (event.type === "replace")
            setMessages((old) =>
              old.map((m) => (m.id === assistantId ? { ...m, content: event.text } : m)),
            );
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
        <aside
          className={`${openCases ? "lg:flex" : "lg:hidden"} hidden w-60 shrink-0 flex-col border-r border-line bg-panel`}
        >
          {caseList}
        </aside>
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-12 shrink-0 items-center gap-3 border-b border-line px-4">
            <button
              className="btn-icon"
              aria-label="Open cases"
              onClick={() => setOpenCases(!openCases)}
            >
              <Menu className="size-5" />
            </button>
            <span className="truncate text-sm text-muted">
              {cases.find((c) => c.id === activeId)?.title || "Technical desk"}
            </span>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <button
                className="btn-icon"
                title="New case"
                aria-label="New case"
                disabled={busy}
                onClick={() => void newCase().catch((e) => setError(e.message))}
              >
                <Plus className="size-4" />
              </button>
              <button className="btn-secondary" onClick={() => setOpenCheck(true)}>
                <SearchCheck className="size-4" />
                <span className="hidden sm:inline">Check knowledge</span>
                <span className="sm:hidden">Check</span>
              </button>
            </div>
          </div>
          <div
            ref={scroller}
            role="region"
            aria-label="Conversation"
            className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8"
          >
            <div className="mx-auto w-full max-w-5xl space-y-6 pb-4 text-[15px]">
              {!messages.length ? (
                <div className="py-3 sm:py-5">
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
                        ? "ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-raised px-5 py-3 text-ink sm:max-w-2xl"
                        : "rounded-2xl border border-line bg-panel p-5 sm:p-6"
                    }
                  >
                    {message.role === "user" ? (
                      <p className="whitespace-pre-wrap leading-6">{message.content}</p>
                    ) : (
                      <>
                        <p className="mb-4 flex items-center gap-2 text-xs font-semibold text-signal">
                          <BookOpen className="size-4" /> PSI-88L
                          {message.status === "error"
                            ? " · Incomplete response"
                            : " · Source-based answer"}
                        </p>
                        {message.content ? (
                          <RichText text={message.content} />
                        ) : (
                          <p className="text-sm text-muted">
                            Searching your evidence and preparing an answer…
                          </p>
                        )}
                        {!!message.sources?.length && (
                          <details className="mt-4 rounded-lg border border-line px-3 py-2">
                            <summary className="cursor-pointer text-sm text-muted">
                              View {message.sources.length} source{" "}
                              {message.sources.length === 1 ? "reference" : "references"}
                            </summary>
                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                              {message.sources.map((source, index) =>
                                source.external ? (
                                  <details
                                    key={source.id}
                                    className="rounded-lg border border-line px-3 py-2 text-xs leading-5 text-muted"
                                  >
                                    <summary className="cursor-pointer">
                                      [{source.citation}] {source.title} · OpenAI file search
                                    </summary>
                                    <p className="mt-2">
                                      Cited from the connected OpenAI store. This file is managed in
                                      OpenAI and is not a published Library source.
                                    </p>
                                    <div className="mt-2 whitespace-pre-wrap break-words">
                                      {source.content}
                                    </div>
                                  </details>
                                ) : (
                                  <Link
                                    key={`${source.id}-${index}`}
                                    to="/library"
                                    search={{
                                      document: source.documentId,
                                      revision: source.revision,
                                    }}
                                    className="rounded-lg border border-line px-3 py-2 text-xs leading-5 text-muted hover:text-ink"
                                  >
                                    [S{index + 1}] {source.title} · {source.locator}
                                  </Link>
                                ),
                              )}
                            </div>
                          </details>
                        )}
                      </>
                    )}
                  </article>
                ))
              )}
            </div>
          </div>
          <div className="shrink-0 px-4 pb-4 pt-2 sm:px-8">
            <div className="mx-auto w-full max-w-5xl">
              {error && (
                <p
                  role="alert"
                  className="mb-3 max-h-24 overflow-y-auto rounded-lg border border-stop px-3 py-2 text-sm text-stop"
                >
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
                className="flex items-end gap-2 rounded-2xl border border-line bg-panel p-2 shadow-lg focus-within:border-signal/60"
              >
                <label className="sr-only" htmlFor="question">
                  Question for the desk
                </label>
                <textarea
                  ref={questionInput}
                  id="question"
                  rows={1}
                  maxLength={8000}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ask PSI-88L…"
                  className="min-w-0 flex-1 resize-none bg-transparent px-3 py-3 text-[15px] leading-5 outline-none placeholder:text-faint"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void ask(question);
                    }
                  }}
                />
                <div className="flex shrink-0 items-center gap-1">
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
              <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 px-2 text-[11px] text-faint">
                <span>
                  {uploading
                    ? "Saving attachments…"
                    : `${status?.published || 0} published sources · ${status?.ai.configured ? status.ai.model : "AI not connected"}`}
                </span>
                <span>Enter to send · Shift+Enter for a new line</span>
              </div>
            </div>
          </div>
        </section>
      </div>
      <dialog
        ref={checkDialog}
        onCancel={() => setOpenCheck(false)}
        className="m-auto max-h-[90dvh] w-[min(900px,94vw)] overflow-auto rounded-2xl border border-line bg-panel p-5 text-ink shadow-2xl backdrop:bg-black/70 sm:p-7"
        aria-label="Knowledge verification"
      >
        <button
          className="btn-icon float-right"
          aria-label="Close knowledge check"
          onClick={() => setOpenCheck(false)}
        >
          <X className="size-5" />
        </button>
        {openCheck && (
          <KnowledgeCheck
            caseId={activeId || undefined}
            initialQuestion={
              question || [...messages].reverse().find((m) => m.role === "user")?.content || ""
            }
          />
        )}
      </dialog>
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
