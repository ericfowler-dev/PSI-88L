import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Database, KeyRound, Users } from "lucide-react";
import { Shell } from "@/components/shell";
import { useSession } from "@/components/session";
import { api, changed, type User } from "@/lib/api";
export const Route = createFileRoute("/settings")({ component: Settings });
type Config = {
  provider: string;
  model: string;
  baseUrl: string;
  hasKey: boolean;
  configured: boolean;
};
type SettingsData = {
  ai: Config;
  storage: string;
  database: string;
  worker: string;
  usage: { requests: number; input_tokens: number; output_tokens: number };
};
function Settings() {
  const { user } = useSession();
  const [data, setData] = useState<SettingsData | null>(null);
  const [members, setMembers] = useState<User[]>([]);
  const [form, setForm] = useState({ provider: "openai", model: "", baseUrl: "", apiKey: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [member, setMember] = useState({ name: "", email: "", password: "", role: "reader" });
  async function refresh() {
    const value = await api<SettingsData>("/api/settings");
    setData(value);
    setForm((f) => ({ ...f, ...value.ai, apiKey: "" }));
    setMembers((await api<{ users: User[] }>("/api/users")).users);
  }
  useEffect(() => {
    if (user.role === "admin") void refresh().catch((e) => setError(e.message));
  }, [user.role]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/api/settings", { method: "PUT", body: JSON.stringify(form) });
      await refresh();
      changed();
      setNotice(
        "Connection settings saved. Ask a source-backed question from the Desk to use this provider.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/users", { method: "POST", body: JSON.stringify(member) });
      setMember({ name: "", email: "", password: "", role: "reader" });
      await refresh();
      setNotice("Team member added.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell section="settings">
      <main className="page-wrap">
        <p className="eyebrow">WORKSPACE</p>
        <h1 className="page-title">Connections & settings</h1>
        <p className="page-description">
          Your knowledge stays here when you change the model connection.
        </p>
        {user.role !== "admin" ? (
          <p className="surface p-6">Only administrators can change workspace settings.</p>
        ) : (
          <>
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
            <div className="grid gap-6 lg:grid-cols-2">
              <section className="surface p-5 sm:p-6">
                <h2 className="section-title">
                  <KeyRound className="size-5" /> AI connection
                </h2>
                <p className="mt-2 text-sm text-muted">
                  API keys are encrypted on the server and are never returned to the browser.
                </p>
                <form onSubmit={save} className="mt-6 space-y-4">
                  <label className="field-label">
                    Provider
                    <select
                      value={form.provider}
                      onChange={(e) =>
                        setForm({ ...form, provider: e.target.value, model: "", apiKey: "" })
                      }
                    >
                      <option value="openai">OpenAI — Responses API</option>
                      <option value="xai">xAI — Grok API</option>
                      <option value="compatible">OpenAI-compatible API</option>
                    </select>
                  </label>
                  <label className="field-label">
                    Model ID
                    <input
                      required
                      placeholder="Model available in your API account"
                      value={form.model}
                      onChange={(e) => setForm({ ...form, model: e.target.value })}
                    />
                  </label>
                  {form.provider === "compatible" && (
                    <label className="field-label">
                      API base URL
                      <input
                        type="url"
                        required
                        placeholder="https://provider.example/v1"
                        value={form.baseUrl}
                        onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                      />
                    </label>
                  )}
                  <label className="field-label">
                    API key
                    <input
                      type="password"
                      autoComplete="new-password"
                      placeholder={
                        data?.ai.hasKey
                          ? "Key stored — leave blank to keep it"
                          : "Paste your provider API key"
                      }
                      value={form.apiKey}
                      onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                    />
                  </label>
                  <button disabled={busy} className="btn-primary">
                    {busy ? "Saving…" : "Save connection"}
                  </button>
                  <p className="text-xs text-muted">
                    Changing providers or endpoints clears the stored key unless you enter a new
                    one.
                  </p>
                </form>
                {data?.ai.configured && (
                  <p className="mt-5 flex items-center gap-2 text-sm text-signal">
                    <CheckCircle2 className="size-4" /> Connection configured · {data.ai.model}
                  </p>
                )}
              </section>
              <section className="surface p-5 sm:p-6">
                <h2 className="section-title">
                  <Database className="size-5" /> Retention & processing
                </h2>
                <dl className="mt-5 space-y-4">
                  {[
                    ["Knowledge & cases", data?.database],
                    ["Original attachments", data?.storage],
                    ["Document processing", data?.worker],
                  ].map(([label, value]) => (
                    <div key={label} className="border-b border-line pb-4">
                      <dt className="text-xs text-muted">{label}</dt>
                      <dd className="mt-1 text-sm">{value || "Loading…"}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-5 text-sm leading-6 text-muted">
                  Uploads are retained independently of the AI provider. Library publication
                  requires review. Case attachments remain private to their owner.
                </p>
                <div className="mt-6 grid grid-cols-3 gap-3">
                  {[
                    ["Requests", data?.usage.requests],
                    ["Input tokens", data?.usage.input_tokens],
                    ["Output tokens", data?.usage.output_tokens],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <p className="font-mono text-xl">{Number(value || 0).toLocaleString()}</p>
                      <p className="mt-1 text-xs text-muted">{label}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
            <section className="surface mt-6 p-5 sm:p-6">
              <h2 className="section-title">
                <Users className="size-5" /> Team access
              </h2>
              <div className="mt-4 divide-y divide-line">
                {members.map((m) => (
                  <div key={m.id} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="font-medium">{m.name}</span>
                    <span className="break-all text-sm text-muted">{m.email}</span>
                    <span className="badge ml-auto">{m.role}</span>
                  </div>
                ))}
              </div>
              <form onSubmit={addUser} className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <label className="field-label">
                  Name
                  <input
                    required
                    value={member.name}
                    onChange={(e) => setMember({ ...member, name: e.target.value })}
                  />
                </label>
                <label className="field-label">
                  Email
                  <input
                    required
                    type="email"
                    value={member.email}
                    onChange={(e) => setMember({ ...member, email: e.target.value })}
                  />
                </label>
                <label className="field-label">
                  Initial password
                  <input
                    required
                    type="password"
                    minLength={12}
                    autoComplete="new-password"
                    value={member.password}
                    onChange={(e) => setMember({ ...member, password: e.target.value })}
                  />
                </label>
                <label className="field-label">
                  Role
                  <select
                    value={member.role}
                    onChange={(e) => setMember({ ...member, role: e.target.value })}
                  >
                    <option value="reader">Technician</option>
                    <option value="editor">Knowledge editor</option>
                    <option value="admin">Administrator</option>
                  </select>
                </label>
                <button disabled={busy} className="btn-secondary self-end">
                  Add member
                </button>
              </form>
            </section>
          </>
        )}
      </main>
    </Shell>
  );
}
