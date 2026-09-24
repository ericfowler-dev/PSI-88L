import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { BookOpen, LockKeyhole } from "lucide-react";
import { api, type User } from "@/lib/api";
const Context = createContext<{ user: User; logout: () => void } | null>(null);
// The context hook intentionally shares this module with its provider.
// eslint-disable-next-line react-refresh/only-export-components
export function useSession() {
  const value = useContext(Context);
  if (!value) throw new Error("Session is unavailable.");
  return value;
}
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<{
    user: User | null;
    needsSetup: boolean;
    setupTokenRequired: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", setupToken: "" });
  async function refresh() {
    try {
      setSession(await api("/api/session"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to connect.");
    }
  }
  useEffect(() => {
    void refresh();
    const expired = () => void refresh();
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(session?.needsSetup ? "/api/setup" : "/api/login", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setForm({ name: "", email: "", password: "", setupToken: "" });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (session?.user)
    return (
      <Context.Provider
        value={{
          user: session.user,
          logout: () => {
            void api("/api/logout", { method: "POST" }).then(refresh);
          },
        }}
      >
        {children}
      </Context.Provider>
    );
  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <BookOpen className="size-10 text-signal" />
          <div>
            <p className="eyebrow">PSI-88L</p>
            <p className="text-sm text-muted">Knowledge & technical support</p>
          </div>
        </div>
        <div className="surface p-6 sm:p-8">
          <LockKeyhole className="mb-5 size-6 text-muted" />
          <h1 className="text-2xl font-semibold">
            {session?.needsSetup
              ? "Create your workspace"
              : session
                ? "Welcome back"
                : "Connecting to your workspace"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            {session?.needsSetup
              ? "Create the first administrator account. Your library, sources, and cases will be retained here."
              : "Sign in to access your retained knowledge and support cases."}
          </p>
          {session && (
            <form onSubmit={submit} className="mt-6 space-y-4">
              {session.needsSetup && (
                <label className="field-label">
                  Name
                  <input
                    required
                    autoComplete="name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </label>
              )}
              <label className="field-label">
                Email
                <input
                  required
                  type="email"
                  autoComplete="username"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </label>
              <label className="field-label">
                Password
                <input
                  required
                  type="password"
                  minLength={12}
                  maxLength={200}
                  autoComplete={session.needsSetup ? "new-password" : "current-password"}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
                {session.needsSetup && (
                  <span className="text-xs text-faint">At least 12 characters.</span>
                )}
              </label>
              {session.needsSetup && session.setupTokenRequired && (
                <label className="field-label">
                  Setup token
                  <input
                    required
                    type="password"
                    autoComplete="off"
                    value={form.setupToken}
                    onChange={(e) => setForm({ ...form, setupToken: e.target.value })}
                  />
                  <span className="text-xs text-faint">
                    Provided by the person hosting this workspace.
                  </span>
                </label>
              )}
              <button className="btn-primary w-full" disabled={busy}>
                {busy ? "Connecting…" : session.needsSetup ? "Create workspace" : "Sign in"}
              </button>
            </form>
          )}
          {error && (
            <p role="alert" className="mt-4 text-sm text-stop">
              {error}
            </p>
          )}
        </div>
        <p className="mt-5 text-center text-xs text-faint">
          An independent support workspace. Not an official PSI service.
        </p>
      </div>
    </main>
  );
}
