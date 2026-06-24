"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Connection, PlatformId } from "@/lib/types";
import { PLATFORM_META, PLATFORM_ORDER, PlatformGlyph } from "@/lib/platforms";

export default function ConnectionsPage() {
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

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Connections</h1>
        <p className="text-sm text-slate-500">Connect your social accounts to aggregate and cross-post.</p>
      </div>

      <section className="card p-5">
        <h2 className="mb-4 font-bold text-slate-900 dark:text-white">Connect a platform</h2>
        <div className="mb-4 flex flex-wrap gap-2">
          {PLATFORM_ORDER.map((p) => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
                platform === p
                  ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200"
                  : "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300"
              }`}
            >
              <PlatformGlyph platform={p} className="h-5 w-5 text-[10px]" />
              {PLATFORM_META[p].name}
            </button>
          ))}
        </div>

        <form onSubmit={connect} className="space-y-3">
          <div>
            <label className="label">{platform === "bluesky" ? "Handle (e.g. you.bsky.social)" : "Handle"}</label>
            <input className="input" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder={platform === "mastodon" ? "@you@mastodon.social" : "@you"} />
          </div>
          {platform === "mastodon" && (
            <div>
              <label className="label">Instance (optional)</label>
              <input className="input" value={instance} onChange={(e) => setInstance(e.target.value)} placeholder="mastodon.social" />
            </div>
          )}
          {platform === "bluesky" && (
            <div>
              <label className="label">App password (demo: any value)</label>
              <input className="input" value={credential} onChange={(e) => setCredential(e.target.value)} placeholder="xxxx-xxxx-xxxx-xxxx" />
            </div>
          )}
          <p className="text-xs text-slate-500">
            Auth method: <span className="font-medium">{meta.authLabel}</span> · Character limit: {meta.charLimit}
          </p>
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          {message && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>}
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Connecting…" : `Connect ${meta.name}`}
          </button>
        </form>
      </section>

      <section className="card p-5">
        <h2 className="mb-4 font-bold text-slate-900 dark:text-white">
          Your connections ({connections.length})
        </h2>
        {connections.length === 0 ? (
          <p className="text-sm text-slate-500">No connections yet.</p>
        ) : (
          <div className="space-y-3">
            {connections.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div className="flex items-center gap-3">
                  <PlatformGlyph platform={c.platform} className="h-9 w-9 text-sm" />
                  <div>
                    <div className="font-semibold text-slate-800 dark:text-slate-100">{c.handle}</div>
                    <div className="text-xs text-slate-500">
                      {PLATFORM_META[c.platform].name}
                      {c.instance ? ` · ${c.instance}` : ""}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                    {c.status}
                  </span>
                  <button onClick={() => disconnect(c.id)} className="btn-ghost px-2 py-1 text-sm text-rose-600">
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
