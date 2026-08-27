"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { FeedPost, ThreadReply } from "@/lib/types";
import { PLATFORM_META, PlatformGlyph } from "@/lib/platforms";

// Phase D5 (read-only): a right-side sheet showing one post's conversation
// — the locally cached post as root, connector-supplied replies below.
// Accessible on the same terms as the connections dialog: role=dialog +
// aria-modal, labelled title, focus moved in on open and restored on
// close, Escape closes, Tab cycles within.

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function ThreadDrawer({ post, onClose }: { post: FeedPost; onClose: () => void }) {
  const [replies, setReplies] = useState<ThreadReply[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = "thread-drawer-title";

  useEffect(() => {
    api
      .thread(post.id)
      .then((r) => setReplies(r.replies))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load the thread."));
  }, [post.id]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>("input, button, [href], [tabindex]:not([tabindex='-1'])") ?? [],
      );
    focusables()[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab") {
        const items = focusables();
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (!panel?.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="animate-fade-up flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-slate-200 bg-white p-5 shadow-2xl outline-none dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Thread
          </h2>
          <button onClick={onClose} className="btn-ghost rounded-full p-2" aria-label="Close thread">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Root post — the locally cached copy the user clicked. */}
        <div className="rounded-xl border border-slate-100 p-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={post.authorAvatar} alt="" className="h-9 w-9 rounded-full" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-semibold text-slate-800 dark:text-slate-100">{post.authorName}</span>
                <PlatformGlyph platform={post.platform} className="h-4 w-4 shrink-0" />
              </div>
              <div className="truncate text-xs text-slate-500">
                {post.authorHandle} · {timeAgo(post.postedAt)} · {PLATFORM_META[post.platform].name}
              </div>
            </div>
          </div>
          <p className="mt-2.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-800 dark:text-slate-200">
            {post.content}
          </p>
        </div>

        <div className="my-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          <span className="h-px flex-1 bg-slate-100 dark:bg-slate-800" />
          Replies
          <span className="h-px flex-1 bg-slate-100 dark:bg-slate-800" />
        </div>

        {error ? (
          <p className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/15 dark:bg-rose-500/10 dark:text-rose-400">
            {error}
          </p>
        ) : replies === null ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
            ))}
          </div>
        ) : replies.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No replies yet.</p>
        ) : (
          <div className="space-y-3">
            {replies.map((r) => (
              <div key={r.externalId} className="rounded-xl border border-slate-100 p-3.5 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.authorAvatar} alt="" className="h-7 w-7 rounded-full" />
                  <div className="min-w-0">
                    <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {r.authorName}
                    </span>
                    <span className="ml-1.5 text-xs text-slate-500">
                      {r.authorHandle} · {timeAgo(r.postedAt)}
                    </span>
                  </div>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                  {r.content}
                </p>
                <div className="mt-2 flex gap-4 text-xs tabular-nums text-slate-400">
                  <span>♥ {r.likeCount.toLocaleString()}</span>
                  <span>↻ {r.repostCount.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
