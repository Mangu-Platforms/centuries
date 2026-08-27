"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { FeedPost, PlatformId } from "@/lib/types";
import { PLATFORM_META, PLATFORM_ORDER, PlatformIcon } from "@/lib/platforms";
import { PostCard } from "@/components/PostCard";
import { ThreadDrawer } from "@/components/ThreadDrawer";

const FILTERS: Array<{ id: "all" | PlatformId; label: string }> = [
  { id: "all", label: "All" },
  ...PLATFORM_ORDER.map((p) => ({ id: p, label: PLATFORM_META[p].name })),
];

export default function FeedPage() {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [platform, setPlatform] = useState<"all" | PlatformId>("all");
  const [search, setSearch] = useState("");
  const [bookmarked, setBookmarked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [threadPost, setThreadPost] = useState<FeedPost | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.feed({ platform, search: search || undefined, bookmarked });
      setPosts(res.posts);
      setCursor(res.nextCursor);
    } finally {
      setLoading(false);
    }
  }, [platform, search, bookmarked]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await api.feed({ cursor, platform, search: search || undefined, bookmarked });
      setPosts((p) => [...p, ...res.posts]);
      setCursor(res.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Unified Feed</h1>
        <p className="mt-1 text-sm text-slate-500">All your platforms, one chronological timeline.</p>
      </div>

      <div className="card sticky top-2 z-10 space-y-3 p-3 backdrop-blur">
        <div className="relative">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            className="input pl-10"
            placeholder="Search your feed…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setPlatform(f.id)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                platform === f.id
                  ? "bg-brand-600 text-white shadow-sm shadow-brand-600/25"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              }`}
            >
              {f.id !== "all" && <PlatformIcon platform={f.id} className="h-3.5 w-3.5" />}
              {f.label}
            </button>
          ))}
          <button
            onClick={() => setBookmarked((b) => !b)}
            className={`ml-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
              bookmarked
                ? "bg-amber-500 text-white shadow-sm shadow-amber-500/25"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              fill={bookmarked ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5"
            >
              <path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
            </svg>
            Bookmarks
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card animate-pulse p-5">
              <div className="flex gap-3">
                <div className="h-11 w-11 rounded-full bg-slate-200 dark:bg-slate-700" />
                <div className="flex-1 space-y-2.5 py-1">
                  <div className="h-3.5 w-1/3 rounded bg-slate-200 dark:bg-slate-700" />
                  <div className="h-3 w-full rounded bg-slate-100 dark:bg-slate-800" />
                  <div className="h-3 w-2/3 rounded bg-slate-100 dark:bg-slate-800" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
              <path d="M4 6h16M4 12h16M4 18h10" />
            </svg>
          </div>
          <p className="font-semibold text-slate-700 dark:text-slate-200">No posts found</p>
          <p className="mt-1 text-sm text-slate-500">Connect a platform or adjust your filters.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((p) => (
            <PostCard key={p.id} post={p} onViewThread={setThreadPost} />
          ))}
        </div>
      )}

      {cursor && !loading && (
        <button onClick={loadMore} disabled={loadingMore} className="btn-outline w-full py-2.5">
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}

      {threadPost && <ThreadDrawer post={threadPost} onClose={() => setThreadPost(null)} />}
    </div>
  );
}
