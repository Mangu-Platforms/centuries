"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { DashboardData, PublishHistoryItem } from "@/lib/types";
import { PLATFORM_META, PlatformGlyph } from "@/lib/platforms";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card p-5">
      <div className="text-2xl font-extrabold text-slate-900 dark:text-white">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
    </div>
  );
}

export default function DashboardOverview() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [history, setHistory] = useState<PublishHistoryItem[]>([]);

  useEffect(() => {
    api.dashboard().then(setData).catch(() => {});
    api.history().then((r) => setHistory(r.jobs)).catch(() => {});
  }, []);

  if (!data) return <p className="text-slate-400">Loading overview…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Overview</h1>
        <p className="text-sm text-slate-500">Your aggregated activity across all connected platforms.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Connected platforms" value={data.stats.connectionsCount} />
        <Stat label="Posts in feed" value={data.stats.totalFeedPosts} />
        <Stat label="Cross-posts sent" value={data.stats.crossPosts} />
        <Stat label="Cross-post success" value={`${data.stats.crossPostSuccessRate}%`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-4 font-bold text-slate-900 dark:text-white">Connected accounts</h2>
          <div className="space-y-3">
            {data.platforms.map((p) => (
              <div key={p.platform} className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <PlatformGlyph platform={p.platform} className="h-7 w-7 text-xs" />
                  {p.name}
                </span>
                {p.connected ? (
                  <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                    Active
                  </span>
                ) : (
                  <Link href="/dashboard/connections" className="text-xs font-semibold text-brand-600 hover:underline">
                    Connect
                  </Link>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-4 font-bold text-slate-900 dark:text-white">Engagement totals</h2>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-xl font-bold text-rose-500">{data.stats.totalLikes.toLocaleString()}</div>
              <div className="text-xs text-slate-500">Likes</div>
            </div>
            <div>
              <div className="text-xl font-bold text-emerald-500">{data.stats.totalReposts.toLocaleString()}</div>
              <div className="text-xs text-slate-500">Reposts</div>
            </div>
            <div>
              <div className="text-xl font-bold text-brand-500">{data.stats.totalReplies.toLocaleString()}</div>
              <div className="text-xs text-slate-500">Replies</div>
            </div>
          </div>
          <div className="mt-4 border-t border-slate-100 pt-4 text-sm text-slate-500 dark:border-slate-800">
            You have authored <span className="font-semibold text-slate-700 dark:text-slate-200">{data.stats.ownPosts}</span> posts via cross-posting.
          </div>
        </section>
      </div>

      <section className="card p-5">
        <h2 className="mb-4 font-bold text-slate-900 dark:text-white">Publishing history</h2>
        {history.length === 0 ? (
          <p className="text-sm text-slate-500">No posts published yet. Hit “New post” to cross-post your first message.</p>
        ) : (
          <div className="space-y-3">
            {history.map((job) => (
              <div key={job.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <p className="text-sm text-slate-800 dark:text-slate-200">{job.content}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-slate-400">{new Date(job.createdAt).toLocaleString()}</span>
                  {job.targets.map((t) => (
                    <span
                      key={t.platform}
                      className={`flex items-center gap-1 rounded-full px-2 py-0.5 ${
                        t.status === "success"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-rose-50 text-rose-700"
                      }`}
                    >
                      <PlatformGlyph platform={t.platform} className="h-3.5 w-3.5 text-[8px]" />
                      {PLATFORM_META[t.platform].name} {t.status === "success" ? "✓" : "✕"}
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
