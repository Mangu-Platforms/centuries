"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AnalyticsData } from "@/lib/types";
import { PlatformGlyph } from "@/lib/platforms";
import { useToast } from "@/lib/toast";

function formatLatency(ms: number): string {
  if (ms === 0) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function formatDayLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" });
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    api.analytics().then(setData).catch(() => showToast("Couldn't load analytics. Try refreshing."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data) return <p className="text-slate-400">Loading analytics…</p>;

  const attempted = data.perPlatform.filter((p) => p.attempts > 0);
  const idle = data.perPlatform.filter((p) => p.attempts === 0);
  const volumeMax = Math.max(1, ...data.feedVolume.map((d) => d.count));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Analytics</h1>
        <p className="mt-1 text-sm text-slate-500">
          Real cross-post success rate and latency per platform, and how much is flowing through your
          unified feed.
        </p>
      </div>

      <section className="card p-5">
        <h2 className="mb-4 font-bold text-slate-900 dark:text-white">Cross-post performance</h2>
        {attempted.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center dark:border-slate-700">
            <p className="text-sm text-slate-500">
              No cross-posts sent yet. Publish a post to see per-platform success rate and latency here.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {attempted.map((p) => (
              <div key={p.platform} className="rounded-xl border border-slate-100 p-4 dark:border-slate-800">
                <div className="mb-2.5 flex items-center justify-between">
                  <span className="flex items-center gap-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
                    <PlatformGlyph platform={p.platform} className="h-8 w-8" />
                    {p.name}
                  </span>
                  <span className="flex items-center gap-4 text-xs text-slate-500">
                    <span>
                      {p.successCount}/{p.attempts} succeeded
                    </span>
                    <span>Avg latency: {formatLatency(p.avgLatencyMs)}</span>
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      p.successRate >= 80 ? "bg-emerald-400" : p.successRate >= 40 ? "bg-amber-400" : "bg-rose-400"
                    }`}
                    style={{ width: `${p.successRate}%` }}
                  />
                </div>
                <div className="mt-1.5 text-right text-xs font-semibold tabular-nums text-slate-500">
                  {p.successRate}% success
                </div>
              </div>
            ))}
          </div>
        )}
        {idle.length > 0 && (
          <p className="mt-4 text-xs text-slate-400">
            Not cross-posted to yet: {idle.map((p) => p.name).join(", ")}.
          </p>
        )}
      </section>

      <section className="card p-5">
        <h2 className="mb-4 font-bold text-slate-900 dark:text-white">Feed volume — last 14 days</h2>
        <div className="flex items-end justify-between gap-1.5" style={{ height: "9rem" }}>
          {data.feedVolume.map((d) => (
            <div key={d.date} className="flex flex-1 flex-col items-center justify-end gap-1.5" title={`${d.date}: ${d.count} posts`}>
              <span className="text-[11px] font-semibold tabular-nums text-slate-500">{d.count}</span>
              <div
                className="w-full rounded-t-md bg-brand-400 transition-all duration-700 dark:bg-brand-500"
                style={{ height: `${Math.max(4, Math.round((d.count / volumeMax) * 100))}%` }}
              />
              <span className="text-[10px] text-slate-400">{formatDayLabel(d.date)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
