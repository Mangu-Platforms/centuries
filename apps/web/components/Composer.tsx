"use client";

import { useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Connection, PlatformId, PublishTargetResult } from "@/lib/types";
import { PLATFORM_META, PLATFORM_ORDER, PlatformGlyph, PlatformIcon } from "@/lib/platforms";

const MAX_MEDIA = 4; // matches POST /api/posts's mediaUrls.max(4)

export function Composer({
  connections,
  onClose,
  onPublished,
}: {
  connections: Connection[];
  onClose: () => void;
  onPublished?: () => void;
}) {
  const connectedPlatforms = useMemo(
    () => Array.from(new Set(connections.map((c) => c.platform))),
    [connections],
  );
  const [content, setContent] = useState("");
  const [selected, setSelected] = useState<PlatformId[]>(connectedPlatforms);
  const [results, setResults] = useState<PublishTargetResult[] | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Generated once per mount — this component fully unmounts when the
  // composer closes (see dashboard/layout.tsx's `{composerOpen && ...}`),
  // so a fresh key is picked up next time it opens for a new post, while a
  // retry within the same open session (a double-click, clicking "Post"
  // again after a dropped response) reuses this one. The API returns the
  // original result for a repeated key instead of publishing again.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const minLimit = selected.length
    ? Math.min(...selected.map((p) => PLATFORM_META[p].charLimit))
    : Infinity;
  const overLimit = selected.some((p) => content.length > PLATFORM_META[p].charLimit);
  const remaining = minLimit === Infinity ? null : minLimit - content.length;
  const progress = minLimit === Infinity ? 0 : Math.min(1, content.length / minLimit);

  const toggle = (p: PlatformId) => {
    setSelected((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));
  };

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    const room = MAX_MEDIA - mediaUrls.length;
    const toUpload = Array.from(files).slice(0, room);
    if (toUpload.length === 0) return;
    setUploading(true);
    try {
      // Sequential, not Promise.all: keeps upload order == the order the
      // user picked files in, and avoids hammering the 20/min rate limit
      // with a burst when someone selects several large images at once.
      for (const file of toUpload) {
        const { url } = await api.uploadMedia(file);
        setMediaUrls((prev) => [...prev, url]);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to upload media");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeMedia = (url: string) => {
    setMediaUrls((prev) => prev.filter((u) => u !== url));
  };

  const submit = async () => {
    setError(null);
    setResults(null);
    if (!content.trim()) return setError("Write something to post.");
    if (selected.length === 0) return setError("Select at least one platform.");
    setSubmitting(true);
    try {
      const res = await api.publish(content.trim(), selected, mediaUrls, idempotencyKey);
      setJobId(res.jobId);
      setResults(res.results);
      onPublished?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to publish");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4 pt-20 backdrop-blur-sm">
      <div className="card animate-fade-up w-full max-w-xl p-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">Compose post</h2>
          <button onClick={onClose} className="btn-ghost rounded-full p-2" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {connectedPlatforms.length === 0 ? (
          <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800 ring-1 ring-inset ring-amber-600/15">
            Connect at least one platform before posting.
          </p>
        ) : results ? (
          <div className="space-y-3">
            <h3 className="font-semibold text-slate-800 dark:text-slate-200">Publishing results</h3>
            {results.map((r) => (
              <div
                key={r.platform}
                className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${
                  r.status === "success"
                    ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-900/10"
                    : r.status === "pending"
                      ? "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-900/10"
                      : "border-rose-200 bg-rose-50/50 dark:border-rose-900 dark:bg-rose-900/10"
                }`}
              >
                <span className="flex items-center gap-2.5 font-medium text-slate-800 dark:text-slate-200">
                  <PlatformGlyph platform={r.platform} className="h-6 w-6" />
                  {PLATFORM_META[r.platform].name}
                </span>
                {r.status === "success" ? (
                  <span className="badge-success">✓ Posted in {(r.latencyMs / 1000).toFixed(1)}s</span>
                ) : r.status === "pending" ? (
                  <span className="badge-pending">Scheduled</span>
                ) : (
                  <span className="badge-danger">✕ {r.error || "Failed"}</span>
                )}
              </div>
            ))}
            {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              {jobId && results.some((r) => r.status === "failed") && (
                <button
                  onClick={async () => {
                    setRetrying(true);
                    try {
                      const res = await api.retryPost(jobId);
                      setResults(res.results);
                    } catch (e) {
                      setError(e instanceof ApiError ? e.message : "Retry failed");
                    } finally {
                      setRetrying(false);
                    }
                  }}
                  disabled={retrying}
                  className="btn-outline"
                >
                  {retrying ? "Retrying…" : "Retry failed targets"}
                </button>
              )}
              <button onClick={onClose} className="btn-primary">
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              placeholder="What's happening?"
              className="input resize-none text-base"
              autoFocus
            />

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {mediaUrls.map((url) => (
                <div key={url} className="group relative h-16 w-16 overflow-hidden rounded-lg ring-1 ring-slate-200 dark:ring-slate-700">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="h-full w-full object-cover" />
                  <button
                    onClick={() => removeMedia(url)}
                    aria-label="Remove image"
                    className="absolute right-0.5 top-0.5 rounded-full bg-slate-950/70 p-0.5 text-white opacity-0 transition group-hover:opacity-100"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-3 w-3">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
              {mediaUrls.length < MAX_MEDIA && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="btn-outline flex h-16 w-16 items-center justify-center rounded-lg text-xs disabled:opacity-50"
                  aria-label="Add photo"
                >
                  {uploading ? (
                    "…"
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  )}
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                multiple
                onChange={(e) => addFiles(e.target.files)}
                className="hidden"
              />
            </div>

            <p className="section-title mb-2 mt-4">Post to</p>
            <div className="flex flex-wrap items-center gap-2">
              {PLATFORM_ORDER.filter((p) => connectedPlatforms.includes(p)).map((p) => {
                const active = selected.includes(p);
                const over = content.length > PLATFORM_META[p].charLimit;
                return (
                  <button
                    key={p}
                    onClick={() => toggle(p)}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                      active
                        ? over
                          ? "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-300"
                          : "border-brand-300 bg-brand-50 text-brand-700 shadow-sm shadow-brand-600/10 dark:border-brand-700 dark:bg-brand-900/40 dark:text-brand-200"
                        : "border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600 dark:border-slate-700 dark:hover:text-slate-300"
                    }`}
                  >
                    <PlatformIcon platform={p} className="h-3.5 w-3.5" />
                    {PLATFORM_META[p].name}
                    {active && (
                      <span className={`text-xs tabular-nums ${over ? "font-bold" : "opacity-60"}`}>
                        {PLATFORM_META[p].charLimit - content.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="flex items-center gap-2.5">
                {minLimit !== Infinity && (
                  <svg viewBox="0 0 24 24" className="h-6 w-6 -rotate-90">
                    <circle cx="12" cy="12" r="9" fill="none" strokeWidth="2.5" className="stroke-slate-200 dark:stroke-slate-700" />
                    <circle
                      cx="12"
                      cy="12"
                      r="9"
                      fill="none"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 9}
                      strokeDashoffset={2 * Math.PI * 9 * (1 - progress)}
                      className={overLimit ? "stroke-rose-500" : progress > 0.85 ? "stroke-amber-500" : "stroke-brand-500"}
                    />
                  </svg>
                )}
                <span className={`tabular-nums ${overLimit ? "font-bold text-rose-600" : "text-slate-500"}`}>
                  {remaining === null ? `${content.length} characters` : `${remaining} left`}
                </span>
              </span>
              {error && <span className="font-medium text-rose-600">{error}</span>}
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
              <button onClick={onClose} className="btn-outline">
                Cancel
              </button>
              <button onClick={submit} disabled={submitting || uploading || overLimit} className="btn-primary">
                {submitting
                  ? "Posting…"
                  : `Post to ${selected.length} platform${selected.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
