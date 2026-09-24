import { Link } from "@tanstack/react-router";
import { BookOpen, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { useSession } from "./session";
export function Shell({
  children,
  section,
  lock,
}: {
  children: ReactNode;
  section: "desk" | "library" | "settings";
  lock?: boolean;
}) {
  const { user, logout } = useSession();
  return (
    <div className={lock ? "flex h-dvh flex-col overflow-hidden" : "flex min-h-dvh flex-col"}>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-panel px-4 py-3 sm:px-6">
        <Link to="/" className="flex min-h-11 items-center gap-3">
          <BookOpen className="size-7 text-signal" />
          <span>
            <span className="block font-mono text-sm tracking-widest text-signal">PSI-88L</span>
            <span className="block text-xs text-muted">Knowledge & support</span>
          </span>
        </Link>
        <nav aria-label="Main navigation" className="ml-auto flex items-center gap-1">
          <Link to="/" className={`nav-link ${section === "desk" ? "bg-raised text-ink" : ""}`}>
            Desk
          </Link>
          <Link
            to="/library"
            search={{ document: "", revision: undefined }}
            className={`nav-link ${section === "library" ? "bg-raised text-ink" : ""}`}
          >
            Library
          </Link>
          {user.role === "admin" && (
            <Link
              to="/settings"
              className={`nav-link ${section === "settings" ? "bg-raised text-ink" : ""}`}
            >
              Settings
            </Link>
          )}
          <button
            className="btn-icon"
            title={`Sign out ${user.name}`}
            aria-label="Sign out"
            onClick={logout}
          >
            <LogOut className="size-4" />
          </button>
        </nav>
      </header>
      {children}
    </div>
  );
}
