"use client";

import { useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Connection, PlatformId, PublishTargetResult } from "@/lib/types";
import { PLATFORM_META, PLATFORM_ORDER, PlatformGlyph } from "@/lib/platforms";

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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const minLimit = selected.length
    ? Math.min(...selected.map((p) => PLATFORM_META[p].charLimit))
    : Infinity;
  const overLimit = selected.some((p) => content.length > PLATFORM_META[p].charLimit);

  const toggle = (p: PlatformId) => {
    setSelected((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));
  };

  const submit = async () => {
    setError(null);
    setResults(null);
    if (!content.trim()) return setError("Write something to post.");
    if (selected.length === 0) return setError("Select at least one platform.");
    setSubmitting(true);
    try {
      const { results } = await api.publish(content.trim(), selected);
      setResults(results);
      onPublished?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to publish");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-20 backdrop-blur-sm">
      <div className="card w-full max-w-xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Compose post</h2>
          <button onClick={onClose} className="btn-ghost px-2 py-1" aria-label="Close">
            ✕
          </button>
        </div>

        {connectedPlatforms.length === 0 ? (
          <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
            Connect at least one platform before posting.
          </p>
        ) : results ? (
          <div className="space-y-3">
            <h3 className="font-semibold text-slate-800 dark:text-slate-200">Publishing results</h3>
            {results.map((r) => (
              <div
                key={r.platform}
                className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700"
              >
                <span className="flex items-center gap-2">
                  <PlatformGlyph platform={r.platform} className="h-5 w-5 text-[10px]" />
                  {PLATFORM_META[r.platform].name}
                </span>
                {r.status === "success" ? (
                  <span className="font-medium text-emerald-600">✓ Posted ({(r.latencyMs / 1000).toFixed(1)}s)</span>
                ) : (
                  <span className="font-medium text-rose-600">✕ {r.error || "Failed"}</span>
                )}
              </div>
            ))}
            <div className="flex justify-end gap-2 pt-2">
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
              className="input resize-none"
              autoFocus
            />

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {PLATFORM_ORDER.filter((p) => connectedPlatforms.includes(p)).map((p) => {
                const active = selected.includes(p);
                return (
                  <button
                    key={p}
                    onClick={() => toggle(p)}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition ${
                      active
                        ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200"
                        : "border-slate-300 text-slate-500 dark:border-slate-700"
                    }`}
                  >
                    <PlatformGlyph platform={p} className="h-4 w-4 text-[9px]" />
                    {PLATFORM_META[p].name}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex items-center justify-between text-sm">
              <span className={overLimit ? "font-semibold text-rose-600" : "text-slate-500"}>
                {content.length}
                {minLimit !== Infinity ? ` / ${minLimit}` : ""} characters
              </span>
              {error && <span className="text-rose-600">{error}</span>}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={onClose} className="btn-outline">
                Cancel
              </button>
              <button onClick={submit} disabled={submitting || overLimit} className="btn-primary">
                {submitting ? "Posting…" : `Post to ${selected.length} platform${selected.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
