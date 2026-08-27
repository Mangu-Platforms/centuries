"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import type { Connection } from "@/lib/types";
import { Composer } from "@/components/Composer";

function Icon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  const paths: Record<string, React.ReactNode> = {
    overview: (
      <>
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </>
    ),
    feed: <path d="M4 6h16M4 12h16M4 18h10" />,
    planner: (
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </>
    ),
    analytics: (
      <>
        <path d="M3 3v18h18" />
        <path d="M18.7 8 12 14.7l-3.3-3.4L4 15.7" />
      </>
    ),
    connections: (
      <>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </>
    ),
    compose: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </>
    ),
    logout: (
      <>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="M16 17l5-5-5-5M21 12H9" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

const NAV = [
  { href: "/dashboard", label: "Overview", icon: "overview" },
  { href: "/dashboard/feed", label: "Unified Feed", icon: "feed" },
  { href: "/dashboard/planner", label: "Planner", icon: "planner" },
  { href: "/dashboard/analytics", label: "Analytics", icon: "analytics" },
  { href: "/dashboard/connections", label: "Connections", icon: "connections" },
  { href: "/dashboard/settings", label: "Settings", icon: "settings" },
];

function Logo() {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow-md shadow-brand-600/30">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-4.5 w-4.5">
        <path d="M6 20V4l12 16V4" />
      </svg>
    </span>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (user) api.connections().then((r) => setConnections(r.connections)).catch(() => {});
  }, [user, composerOpen]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>
    );
  }

  const initials = user.displayName
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto flex max-w-7xl">
        <aside className="sticky top-0 hidden h-screen w-64 flex-col border-r border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 md:flex">
          <Link
            href="/dashboard"
            className="mb-8 flex items-center gap-2.5 px-2 text-xl font-extrabold tracking-tight text-slate-900 dark:text-white"
          >
            <Logo />
            NEXUS
          </Link>

          <p className="section-title mb-2 px-3">Menu</p>
          <nav className="flex-1 space-y-1">
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                    active
                      ? "bg-brand-50 text-brand-700 shadow-sm shadow-brand-600/5 dark:bg-brand-900/40 dark:text-brand-200"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  }`}
                >
                  <span className={active ? "text-brand-600 dark:text-brand-300" : "text-slate-400 group-hover:text-slate-500 dark:text-slate-500"}>
                    <Icon name={item.icon} />
                  </span>
                  {item.label}
                  {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-500" />}
                </Link>
              );
            })}
          </nav>

          <button onClick={() => setComposerOpen(true)} className="btn-primary mb-4 w-full py-2.5">
            <Icon name="compose" className="h-4 w-4" />
            New post
          </button>

          <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-800/40">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-violet-600 text-xs font-bold text-white">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{user.displayName}</div>
              <div className="truncate text-xs text-slate-500">{user.email}</div>
            </div>
            <button onClick={logout} className="btn-ghost shrink-0 px-1.5 py-1.5 text-slate-400 hover:text-rose-500" title="Log out">
              <Icon name="logout" className="h-4 w-4" />
            </button>
          </div>
        </aside>

        <main className="min-h-screen flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mb-4 flex items-center justify-between md:hidden">
            <Link href="/dashboard" className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-slate-900 dark:text-white">
              <Logo />
              NEXUS
            </Link>
            <button onClick={() => setComposerOpen(true)} className="btn-primary px-3 py-1.5 text-sm">
              <Icon name="compose" className="h-4 w-4" />
              Post
            </button>
          </div>
          <nav className="mb-4 flex gap-1 overflow-x-auto md:hidden">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap rounded-xl px-3 py-1.5 text-sm font-medium ${
                  pathname === item.href
                    ? "bg-brand-600 text-white shadow-sm shadow-brand-600/25"
                    : "bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          {children}
        </main>
      </div>

      {composerOpen && (
        <Composer connections={connections} onClose={() => setComposerOpen(false)} />
      )}
    </div>
  );
}
