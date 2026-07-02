"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { FeedPost } from "@/lib/types";
import { PlatformGlyph } from "@/lib/platforms";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[18px] w-[18px]"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function RepostIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
      <path d="m17 1 4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="m7 23-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function ReplyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[18px] w-[18px]"
    >
      <path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
    </svg>
  );
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
    <article className="card card-hover p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          {state.authorAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={state.authorAvatar} alt="" className="h-11 w-11 rounded-full ring-1 ring-black/5" />
          ) : (
            <PlatformGlyph platform={state.platform} className="h-11 w-11" />
          )}
          <span className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-white dark:ring-slate-900">
            <PlatformGlyph platform={state.platform} className="h-[18px] w-[18px]" />
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold text-slate-900 dark:text-slate-100">
              {state.authorName}
            </span>
            <span className="truncate text-sm text-slate-500">{state.authorHandle}</span>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <span className="shrink-0 text-sm text-slate-400">{timeAgo(state.postedAt)}</span>
            {state.isOwn && (
              <span className="ml-auto shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-700 ring-1 ring-inset ring-brand-600/15 dark:bg-brand-900/40 dark:text-brand-300">
                You
              </span>
            )}
          </div>

          <p className="mt-1.5 whitespace-pre-wrap break-words leading-relaxed text-slate-800 dark:text-slate-200">
            {state.content}
          </p>

          <div className="mt-3 flex items-center gap-1 text-sm text-slate-500">
            <button
              onClick={toggleLike}
              disabled={busy}
              className={`group flex items-center gap-1.5 rounded-full px-2.5 py-1.5 transition hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10 ${
                state.liked ? "text-rose-500" : ""
              }`}
              aria-label="Like"
            >
              <HeartIcon filled={state.liked} />
              <span className="tabular-nums">{state.likeCount.toLocaleString()}</span>
            </button>
            <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5">
              <RepostIcon />
              <span className="tabular-nums">{state.repostCount.toLocaleString()}</span>
            </span>
            <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5">
              <ReplyIcon />
              <span className="tabular-nums">{state.replyCount.toLocaleString()}</span>
            </span>
            <button
              onClick={toggleBookmark}
              className={`ml-auto rounded-full p-1.5 transition hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-500/10 ${
                state.bookmarked ? "text-brand-600" : ""
              }`}
              aria-label="Bookmark"
            >
              <BookmarkIcon filled={state.bookmarked} />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
