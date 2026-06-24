"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import type { Connection } from "@/lib/types";
import { Composer } from "@/components/Composer";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: "📊" },
  { href: "/dashboard/feed", label: "Unified Feed", icon: "🗞️" },
  { href: "/dashboard/connections", label: "Connections", icon: "🔗" },
  { href: "/dashboard/settings", label: "Settings", icon: "⚙️" },
];

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

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto flex max-w-7xl">
        <aside className="sticky top-0 hidden h-screen w-64 flex-col border-r border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 md:flex">
          <Link href="/dashboard" className="mb-6 flex items-center gap-2 px-2 text-xl font-extrabold text-slate-900 dark:text-white">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">N</span>
            NEXUS
          </Link>
          <nav className="flex-1 space-y-1">
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    active
                      ? "bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  }`}
                >
                  <span>{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <button onClick={() => setComposerOpen(true)} className="btn-primary mb-3 w-full">
            ✍️ New post
          </button>
          <div className="flex items-center justify-between rounded-lg px-2 py-2 text-sm">
            <div className="min-w-0">
              <div className="truncate font-semibold text-slate-800 dark:text-slate-100">{user.displayName}</div>
              <div className="truncate text-xs text-slate-500">{user.email}</div>
            </div>
            <button onClick={logout} className="btn-ghost px-2 py-1 text-xs" title="Log out">
              ⏻
            </button>
          </div>
        </aside>

        <main className="min-h-screen flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mb-4 flex items-center justify-between md:hidden">
            <Link href="/dashboard" className="text-lg font-extrabold text-slate-900 dark:text-white">
              NEXUS
            </Link>
            <button onClick={() => setComposerOpen(true)} className="btn-primary px-3 py-1.5 text-sm">
              ✍️ Post
            </button>
          </div>
          <nav className="mb-4 flex gap-1 overflow-x-auto md:hidden">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${
                  pathname === item.href ? "bg-brand-600 text-white" : "bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300"
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
