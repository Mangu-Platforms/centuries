"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { PublishHistoryItem } from "@/lib/types";
import { PLATFORM_META, PlatformGlyph } from "@/lib/platforms";
import { localDateTimeValue } from "@/components/Composer";
import { useToast } from "@/lib/toast";

// Phase E8 — Planner v0: the list of not-yet-fired scheduled posts, with
// cancel and edit (both only valid while every target is pending and the
// fire time is still in the future; the API enforces the same rule).

function isUpcoming(job: PublishHistoryItem): boolean {
  return (
    job.scheduledAt !== null &&
    new Date(job.scheduledAt).getTime() > Date.now() &&
    job.targets.every((t) => t.status === "pending")
  );
}

export default function PlannerPage() {
  const [jobs, setJobs] = useState<PublishHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    api
      .history()
      .then((r) => setJobs(r.jobs.filter(isUpcoming)))
      .catch(() => showToast("Couldn't load scheduled posts."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    try {
      await api.cancelPost(id);
      setJobs((js) => js.filter((j) => j.id !== id));
      showToast("Scheduled post canceled.");
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : "Couldn't cancel. Try again.");
    } finally {
      setBusyId(null);
    }
  };

  const startEdit = (job: PublishHistoryItem) => {
    setEditingId(job.id);
    setEditContent(job.content);
    setEditTime(job.scheduledAt ? localDateTimeValue(new Date(job.scheduledAt)) : "");
    setEditError(null);
  };

  const saveEdit = async (job: PublishHistoryItem) => {
    setEditError(null);
    const limit = Math.min(...job.targets.map((t) => PLATFORM_META[t.platform].charLimit));
    if (editContent.length > limit) {
      return setEditError(`Content exceeds this post's tightest limit (${limit} characters).`);
    }
    if (!editTime) return setEditError("Pick a send time.");
    const when = new Date(editTime);
    if (when.getTime() <= Date.now()) return setEditError("The send time must be in the future.");

    setBusyId(job.id);
    try {
      const res = await api.editPost(job.id, {
        content: editContent.trim(),
        scheduledAt: when.toISOString(),
      });
      setJobs((js) =>
        js.map((j) =>
          j.id === job.id ? { ...j, content: res.job.content, scheduledAt: res.job.scheduledAt } : j,
        ),
      );
      setEditingId(null);
      showToast("Scheduled post updated.");
    } catch (e) {
      setEditError(e instanceof ApiError ? e.message : "Couldn't save. Try again.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Planner</h1>
        <p className="mt-1 text-sm text-slate-500">
          Posts waiting to fire. Cancel or reword them any time before they&apos;re due.
        </p>
      </div>

      <section className="card p-5 sm:p-6">
        {loading ? (
          <p className="text-slate-400">Loading scheduled posts…</p>
        ) : jobs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center dark:border-slate-700">
            <p className="text-sm text-slate-500">
              Nothing scheduled. Hit{" "}
              <span className="font-semibold text-slate-700 dark:text-slate-200">New post</span> and
              choose <span className="font-semibold text-slate-700 dark:text-slate-200">Schedule</span>{" "}
              to queue one up.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="rounded-xl border border-slate-100 p-4 transition hover:border-slate-200 dark:border-slate-800 dark:hover:border-slate-700"
              >
                {editingId === job.id ? (
                  <div className="space-y-3">
                    <div>
                      <label className="label" htmlFor={`edit-content-${job.id}`}>
                        Post content
                      </label>
                      <textarea
                        id={`edit-content-${job.id}`}
                        className="input resize-none"
                        rows={3}
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="label" htmlFor={`edit-time-${job.id}`}>
                        Send at
                      </label>
                      <input
                        id={`edit-time-${job.id}`}
                        type="datetime-local"
                        className="input"
                        value={editTime}
                        min={localDateTimeValue(new Date(Date.now() + 60_000))}
                        onChange={(e) => setEditTime(e.target.value)}
                      />
                    </div>
                    {editError && (
                      <p className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/15 dark:bg-rose-500/10 dark:text-rose-400">
                        {editError}
                      </p>
                    )}
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditingId(null)} className="btn-outline">
                        Discard changes
                      </button>
                      <button
                        onClick={() => saveEdit(job)}
                        disabled={busyId === job.id}
                        className="btn-primary"
                      >
                        {busyId === job.id ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                      {job.content}
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
                      <span className="badge-pending">
                        Fires {job.scheduledAt ? new Date(job.scheduledAt).toLocaleString() : ""}
                      </span>
                      {job.targets.map((t) => (
                        <span key={t.platform} className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          <PlatformGlyph platform={t.platform} className="h-3.5 w-3.5" />
                          {PLATFORM_META[t.platform].name}
                        </span>
                      ))}
                      <span className="ml-auto flex gap-1.5">
                        <button
                          onClick={() => startEdit(job)}
                          className="btn-ghost px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => cancel(job.id)}
                          aria-disabled={busyId === job.id}
                          className={`btn-ghost px-2.5 py-1.5 text-xs font-semibold text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 ${
                            busyId === job.id ? "cursor-not-allowed opacity-50" : ""
                          }`}
                        >
                          {busyId === job.id ? "Canceling…" : "Cancel post"}
                        </button>
                      </span>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
