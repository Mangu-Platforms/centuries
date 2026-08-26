"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type { Connection, PlatformId } from "@/lib/types";
import { PLATFORM_META, PLATFORM_ORDER, PlatformGlyph } from "@/lib/platforms";

export default function ConnectionsPage() {
  return (
    <Suspense fallback={null}>
      <ConnectionsPageInner />
    </Suspense>
  );
}

function ConnectionsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [platform, setPlatform] = useState<PlatformId>("twitter");
  const [handle, setHandle] = useState("");
  const [instance, setInstance] = useState("");
  const [credential, setCredential] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.connections().then((r) => setConnections(r.connections)).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  // Returning from the Mastodon OAuth redirect (routes/mastodonAuth.ts sends
  // the browser back here with these query params) — surface the result
  // once, then strip them from the URL so a refresh doesn't re-show it.
  useEffect(() => {
    const connected = searchParams.get("mastodonConnected");
    const imported = searchParams.get("imported");
    const mastodonError = searchParams.get("mastodonError");
    if (connected) {
      setMessage(`Connected Mastodon! Imported ${imported ?? 0} posts.`);
      setError(null);
      load();
      router.replace("/dashboard/connections");
    } else if (mastodonError) {
      setError(mastodonError);
      setMessage(null);
      router.replace("/dashboard/connections");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (platform === "mastodon") {
      if (!instance.trim()) return setError("Enter your Mastodon instance (e.g. mastodon.social).");
      setBusy(true);
      try {
        const { authorizeUrl } = await api.mastodonRegister(instance.trim());
        window.location.href = authorizeUrl;
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to start Mastodon authorization");
        setBusy(false);
      }
      return;
    }

    if (!handle.trim()) return setError("Enter your handle.");
    setBusy(true);
    try {
      const res = await api.connect(platform, handle.trim(), instance || undefined, credential || undefined);
      setMessage(`Connected ${PLATFORM_META[platform].name}! Imported ${res.importedPosts} posts.`);
      setHandle("");
      setInstance("");
      setCredential("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to connect");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (id: string) => {
    await api.disconnect(id);
    load();
  };

  const meta = PLATFORM_META[platform];
  const connectedIds = new Set(connections.map((c) => c.platform));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Connections</h1>
        <p className="mt-1 text-sm text-slate-500">Connect your social accounts to aggregate and cross-post.</p>
      </div>

      <section className="card p-5 sm:p-6">
        <h2 className="mb-4 font-bold text-slate-900 dark:text-white">Connect a platform</h2>

        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PLATFORM_ORDER.map((p) => {
            const active = platform === p;
            const isConnected = connectedIds.has(p);
            return (
              <button
                key={p}
                onClick={() => setPlatform(p)}
                className={`relative flex flex-col items-center gap-2 rounded-2xl border p-4 transition ${
                  active
                    ? "border-brand-300 bg-brand-50/70 shadow-sm shadow-brand-600/10 dark:border-brand-700 dark:bg-brand-900/30"
                    : "border-slate-200 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60"
                }`}
              >
                {isConnected && (
                  <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white" title="Connected">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="h-2.5 w-2.5">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
                )}
                <PlatformGlyph platform={p} className="h-10 w-10" />
                <span
                  className={`text-xs font-semibold ${
                    active ? "text-brand-700 dark:text-brand-200" : "text-slate-600 dark:text-slate-300"
                  }`}
                >
                  {PLATFORM_META[p].name}
                </span>
              </button>
            );
          })}
        </div>

        <form onSubmit={connect} className="space-y-4">
          {platform === "mastodon" ? (
            <div>
              <label className="label">Your Mastodon instance</label>
              <input
                className="input"
                value={instance}
                onChange={(e) => setInstance(e.target.value)}
                placeholder="mastodon.social"
              />
              <p className="mt-1.5 text-xs text-slate-500">
                You&apos;ll be sent to your instance to sign in and approve NEXUS — no account handle needed here.
              </p>
            </div>
          ) : (
            <div>
              <label className="label">{platform === "bluesky" ? "Handle (e.g. you.bsky.social)" : "Handle"}</label>
              <input
                className="input"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="@you"
              />
            </div>
          )}
          {platform === "bluesky" && (
            <div>
              <label className="label">App password (demo: any value)</label>
              <input
                className="input"
                value={credential}
                onChange={(e) => setCredential(e.target.value)}
                placeholder="xxxx-xxxx-xxxx-xxxx"
              />
            </div>
          )}

          <div className="flex flex-wrap gap-2 text-xs">
            <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              Auth: {meta.authLabel}
            </span>
            <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {meta.charLimit} character limit
            </span>
          </div>

          {error && (
            <p className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/15">
              {error}
            </p>
          )}
          {message && (
            <p className="rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-600/15">
              {message}
            </p>
          )}

          <button type="submit" className="btn-primary" disabled={busy}>
            {busy
              ? platform === "mastodon"
                ? "Redirecting…"
                : "Connecting…"
              : platform === "mastodon"
                ? "Continue to your instance"
                : `Connect ${meta.name}`}
          </button>
        </form>
      </section>

      <section className="card p-5 sm:p-6">
        <h2 className="mb-4 font-bold text-slate-900 dark:text-white">
          Your connections{" "}
          <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {connections.length}
          </span>
        </h2>
        {connections.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center dark:border-slate-700">
            <p className="text-sm text-slate-500">No connections yet. Pick a platform above to get started.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {connections.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-xl border border-slate-100 p-3.5 transition hover:border-slate-200 dark:border-slate-800 dark:hover:border-slate-700"
              >
                <div className="flex items-center gap-3.5">
                  <PlatformGlyph platform={c.platform} className="h-10 w-10" />
                  <div>
                    <div className="font-semibold text-slate-800 dark:text-slate-100">{c.handle}</div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {PLATFORM_META[c.platform].name}
                      {c.instance ? ` · ${c.instance}` : ""}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="badge-success">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    {c.status}
                  </span>
                  <button
                    onClick={() => disconnect(c.id)}
                    className="btn-ghost px-2.5 py-1.5 text-sm text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
