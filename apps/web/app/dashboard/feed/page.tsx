"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { FeedPost, PlatformId } from "@/lib/types";
import { PLATFORM_META, PLATFORM_ORDER, PlatformGlyph } from "@/lib/platforms";
import { PostCard } from "@/components/PostCard";

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
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Unified Feed</h1>
        <p className="text-sm text-slate-500">All your platforms, one chronological timeline.</p>
      </div>

      <div className="card sticky top-2 z-10 space-y-3 p-3">
        <input
          className="input"
          placeholder="Search your feed…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setPlatform(f.id)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition ${
                platform === f.id
                  ? "bg-brand-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              {f.id !== "all" && <PlatformGlyph platform={f.id} className="h-4 w-4 text-[9px]" />}
              {f.label}
            </button>
          ))}
          <button
            onClick={() => setBookmarked((b) => !b)}
            className={`ml-auto rounded-full px-3 py-1 text-sm transition ${
              bookmarked ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            {bookmarked ? "★ Bookmarked" : "☆ Bookmarks"}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="py-10 text-center text-slate-400">Loading feed…</p>
      ) : posts.length === 0 ? (
        <div className="card p-10 text-center text-slate-500">
          No posts found. Connect a platform or adjust your filters.
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>
      )}

      {cursor && !loading && (
        <button onClick={loadMore} disabled={loadingMore} className="btn-outline w-full">
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
