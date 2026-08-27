"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { DashboardData, PublishHistoryItem } from "@/lib/types";
import { PLATFORM_META, PlatformGlyph } from "@/lib/platforms";
import { useToast } from "@/lib/toast";

const STAT_STYLES: Record<string, { iconBg: string; icon: React.ReactNode }> = {
  platforms: {
    iconBg: "bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    ),
  },
  posts: {
    iconBg: "bg-sky-50 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M4 6h16M4 12h16M4 18h10" />
      </svg>
    ),
  },
  sent: {
    iconBg: "bg-violet-50 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
      </svg>
    ),
  },
  success: {
    iconBg: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <path d="M22 4 12 14.01l-3-3" />
      </svg>
    ),
  },
};

function Stat({ label, value, kind }: { label: string; value: string | number; kind: keyof typeof STAT_STYLES }) {
  const s = STAT_STYLES[kind];
  return (
    <div className="card card-hover flex items-center gap-4 p-5">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${s.iconBg}`}>{s.icon}</div>
      <div>
        <div className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">{value}</div>
        <div className="mt-0.5 text-sm text-slate-500">{label}</div>
      </div>
    </div>
  );
}

export default function DashboardOverview() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [history, setHistory] = useState<PublishHistoryItem[]>([]);
  const { showToast } = useToast();

  useEffect(() => {
    api.dashboard().then(setData).catch(() => showToast("Couldn't load your overview. Try refreshing."));
    api.history().then((r) => setHistory(r.jobs)).catch(() => showToast("Couldn't load publish history."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data) return <p className="text-slate-400">Loading overview…</p>;

  const engagement = [
    { label: "Likes", value: data.stats.totalLikes, color: "text-rose-500", bar: "bg-rose-400" },
    { label: "Reposts", value: data.stats.totalReposts, color: "text-emerald-500", bar: "bg-emerald-400" },
    { label: "Replies", value: data.stats.totalReplies, color: "text-brand-500", bar: "bg-brand-400" },
  ];
  const engagementMax = Math.max(1, ...engagement.map((e) => e.value));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Overview</h1>
        <p className="mt-1 text-sm text-slate-500">Your aggregated activity across all connected platforms.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat kind="platforms" label="Connected platforms" value={data.stats.connectionsCount} />
        <Stat kind="posts" label="Posts in feed" value={data.stats.totalFeedPosts} />
        <Stat kind="sent" label="Cross-posts sent" value={data.stats.crossPosts} />
        <Stat kind="success" label="Cross-post success" value={`${data.stats.crossPostSuccessRate}%`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-4 font-bold text-slate-900 dark:text-white">Connected accounts</h2>
          <div className="space-y-2">
            {data.platforms.map((p) => (
              <div
                key={p.platform}
                className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2.5 dark:border-slate-800"
              >
                <span className="flex items-center gap-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                  <PlatformGlyph platform={p.platform} className="h-8 w-8" />
                  <span>
                    {p.name}
                    <span className="block text-xs font-normal text-slate-400">{p.charLimit} char limit</span>
                  </span>
                </span>
                {p.connected ? (
                  <span className="badge-success">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Active
                  </span>
                ) : (
                  <Link href="/dashboard/connections" className="text-xs font-semibold text-brand-600 hover:underline">
                    Connect →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-4 font-bold text-slate-900 dark:text-white">Engagement totals</h2>
          <div className="space-y-4">
            {engagement.map((e) => (
              <div key={e.label}>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <span className="text-sm font-medium text-slate-600 dark:text-slate-300">{e.label}</span>
                  <span className={`text-lg font-bold tabular-nums ${e.color}`}>{e.value.toLocaleString()}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className={`h-full rounded-full ${e.bar} transition-all duration-700`}
                    style={{ width: `${Math.round((e.value / engagementMax) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 border-t border-slate-100 pt-4 text-sm text-slate-500 dark:border-slate-800">
            You have authored{" "}
            <span className="font-semibold text-slate-700 dark:text-slate-200">{data.stats.ownPosts}</span> posts via
            cross-posting.
          </div>
        </section>
      </div>

      <section className="card p-5">
        <h2 className="mb-4 font-bold text-slate-900 dark:text-white">Publishing history</h2>
        {history.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center dark:border-slate-700">
            <p className="text-sm text-slate-500">
              No posts published yet. Hit <span className="font-semibold text-slate-700 dark:text-slate-200">New post</span> to
              cross-post your first message.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {history.map((job) => (
              <div key={job.id} className="rounded-xl border border-slate-100 p-4 transition hover:border-slate-200 dark:border-slate-800 dark:hover:border-slate-700">
                <p className="text-sm leading-relaxed text-slate-800 dark:text-slate-200">{job.content}</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-slate-400">{new Date(job.createdAt).toLocaleString()}</span>
                  {job.scheduledAt && (
                    <>
                      <span className="text-slate-300 dark:text-slate-600">·</span>
                      <span className="text-slate-400">
                        Scheduled for {new Date(job.scheduledAt).toLocaleString()}
                      </span>
                    </>
                  )}
                  <span className="text-slate-300 dark:text-slate-600">·</span>
                  {job.targets.map((t) => (
                    <span
                      key={t.platform}
                      className={
                        t.status === "success" ? "badge-success" : t.status === "pending" ? "badge-pending" : "badge-danger"
                      }
                    >
                      <PlatformGlyph platform={t.platform} className="h-3.5 w-3.5" />
                      {PLATFORM_META[t.platform].name}{" "}
                      {t.status === "success"
                        ? `✓ ${(t.latencyMs / 1000).toFixed(1)}s`
                        : t.status === "pending"
                          ? "· Pending"
                          : `✕ ${t.error || "Failed"}`}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
