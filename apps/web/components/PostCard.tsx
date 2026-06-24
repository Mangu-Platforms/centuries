"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { FeedPost } from "@/lib/types";
import { PLATFORM_META, PlatformGlyph } from "@/lib/platforms";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function PostCard({ post }: { post: FeedPost }) {
  const [state, setState] = useState(post);
  const [busy, setBusy] = useState(false);

  const toggleLike = async () => {
    setBusy(true);
    // Optimistic update
    setState((s) => ({ ...s, liked: !s.liked, likeCount: s.likeCount + (s.liked ? -1 : 1) }));
    try {
      const { post } = await api.like(state.id);
      setState(post);
    } catch {
      setState((s) => ({ ...s, liked: !s.liked, likeCount: s.likeCount + (s.liked ? -1 : 1) }));
    } finally {
      setBusy(false);
    }
  };

  const toggleBookmark = async () => {
    setState((s) => ({ ...s, bookmarked: !s.bookmarked }));
    try {
      const { post } = await api.bookmark(state.id);
      setState(post);
    } catch {
      setState((s) => ({ ...s, bookmarked: !s.bookmarked }));
    }
  };

  return (
    <article className="card p-4">
      <div className="flex items-start gap-3">
        {state.authorAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={state.authorAvatar} alt="" className="h-10 w-10 rounded-full" />
        ) : (
          <PlatformGlyph platform={state.platform} className="h-10 w-10 text-sm" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold text-slate-900 dark:text-slate-100">
              {state.authorName}
            </span>
            <span className="truncate text-sm text-slate-500">{state.authorHandle}</span>
            <span className="text-slate-400">·</span>
            <span className="text-sm text-slate-400">{timeAgo(state.postedAt)}</span>
            <span className="ml-auto flex items-center gap-1">
              {state.isOwn && (
                <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                  You
                </span>
              )}
              <PlatformGlyph platform={state.platform} className="h-5 w-5 text-[10px]" />
            </span>
          </div>

          <p className="mt-1 whitespace-pre-wrap break-words text-slate-800 dark:text-slate-200">
            {state.content}
          </p>

          <div className="mt-3 flex items-center gap-6 text-sm text-slate-500">
            <button
              onClick={toggleLike}
              disabled={busy}
              className={`flex items-center gap-1.5 transition hover:text-rose-500 ${
                state.liked ? "text-rose-500" : ""
              }`}
              aria-label="Like"
            >
              <span>{state.liked ? "♥" : "♡"}</span>
              <span>{state.likeCount.toLocaleString()}</span>
            </button>
            <span className="flex items-center gap-1.5">↻ {state.repostCount.toLocaleString()}</span>
            <span className="flex items-center gap-1.5">💬 {state.replyCount.toLocaleString()}</span>
            <button
              onClick={toggleBookmark}
              className={`ml-auto transition hover:text-brand-600 ${
                state.bookmarked ? "text-brand-600" : ""
              }`}
              aria-label="Bookmark"
              title={`Char limit: ${PLATFORM_META[state.platform].charLimit}`}
            >
              {state.bookmarked ? "★" : "☆"}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
