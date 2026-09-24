export type User = { id: string; name: string; email: string; role: "admin" | "editor" | "reader" };
export type KnowledgeDocument = {
  id: string;
  title: string;
  filename: string;
  media_type: string;
  byte_size: number;
  status: string;
  revision: number;
  source_note: string;
  case_id: string | null;
  warnings: string[];
  error: string | null;
  chunk_count: number;
  updated_at: string;
};
export type Source = {
  id: string;
  documentId: string;
  title: string;
  filename: string;
  revision: number;
  locator: string;
  content: string;
};
export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: Source[];
  status: string;
};
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  const body = await response.json();
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("session-expired"));
    throw new Error(body.error || "The request failed.");
  }
  return body as T;
}
export function changed() {
  window.dispatchEvent(new Event("workspace-changed"));
}
export const SUPPORTED =
  ".pdf,.txt,.log,.md,.csv,.tsv,.json,.jsonl,.xml,.yaml,.yml,.ini,.conf,.docx,.png,.jpg,.jpeg,.webp";
export async function uploadFile(file: File, caseId?: string) {
  const form = new FormData();
  form.append("file", file);
  if (caseId) form.append("caseId", caseId);
  return api<{ document: KnowledgeDocument; duplicate: boolean }>("/api/knowledge/upload", {
    method: "POST",
    body: form,
  });
}
export function bytes(value: number) {
  return value > 1024 * 1024
    ? `${(value / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(value / 1024))} KB`;
}
