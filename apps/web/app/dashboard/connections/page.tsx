"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type { Connection, PlatformId } from "@/lib/types";
import { PLATFORM_META, PLATFORM_ORDER, PlatformGlyph } from "@/lib/platforms";
import { useToast } from "@/lib/toast";

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const STATUS_BADGE: Record<Connection["status"], { className: string; dot: string }> = {
  active: { className: "badge-success", dot: "bg-emerald-500" },
  expired: { className: "badge-pending", dot: "bg-amber-500" },
  error: { className: "badge-danger", dot: "bg-rose-500" },
};

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
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Which connection a modal is open for, if any. "reconnect" is only used
  // for app-password platforms (it re-prompts the credential); OAuth
  // platforms redirect through their authorization flow instead, and
  // credential-less (demo-mode) connections reconnect directly.
  const [dialog, setDialog] = useState<{ kind: "disconnect" | "reconnect"; connection: Connection } | null>(null);
  const [reconnectingId, setReconnectingId] = useState<string | null>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const { showToast } = useToast();

  const load = () =>
    api.connections().then((r) => setConnections(r.connections)).catch(() => showToast("Couldn't load your connections."));
  useEffect(() => {
    load();
  }, []);

  // Returning via the browser Back button from an abandoned OAuth redirect
  // typically restores this page from the bfcache with its old state —
  // including a stuck "Reconnecting…"/"Redirecting…" busy flag. Clear both.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        setReconnectingId(null);
        setBusy(false);
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  // Returning from the Mastodon OAuth redirect (routes/mastodonAuth.ts sends
  // the browser back here with these query params) — surface the result
  // once, then strip them from the URL so a refresh doesn't re-show it.
  useEffect(() => {
    const connected = searchParams.get("mastodonConnected");
    const imported = searchParams.get("imported");
    const reconnected = searchParams.get("reconnected");
    const mastodonError = searchParams.get("mastodonError");
    if (connected) {
      setMessage(
        `${reconnected ? "Reconnected" : "Connected"} Mastodon! Imported ${imported ?? 0} posts.`,
      );
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
    setWarning(null);

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
      if (res.warning) {
        // C1b: a live credential the platform rejected keeps the connection
        // (status "error") — say so instead of a false success.
        setWarning(res.warning);
      } else {
        setMessage(`Connected ${PLATFORM_META[platform].name}! Imported ${res.importedPosts} posts.`);
      }
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
    try {
      await api.disconnect(id);
      load();
    } catch {
      showToast("Couldn't disconnect. Try again.");
    }
  };

  // Reconnect for OAuth platforms = re-run the authorization flow; for
  // app-password platforms = re-prompt the credential (modal); for
  // credential-less demo-mode connections = just re-fetch the timeline.
  const startReconnect = async (c: Connection) => {
    if (reconnectingId) return; // one reconnect at a time; button is aria-disabled, not disabled, so guard here
    if (c.platform === "mastodon" && c.instance) {
      setReconnectingId(c.id);
      try {
        const { authorizeUrl } = await api.mastodonRegister(c.instance);
        window.location.href = authorizeUrl;
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : "Failed to start Mastodon authorization");
        setReconnectingId(null);
      }
      return;
    }
    if (PLATFORM_META[c.platform].authKind === "app_password") {
      setDialog({ kind: "reconnect", connection: c });
      return;
    }
    await runReconnect(c.id);
  };

  const runReconnect = async (id: string, newCredential?: string) => {
    setReconnectingId(id);
    setMessage(null);
    setWarning(null);
    setError(null);
    try {
      const res = await api.reconnect(id, newCredential);
      if (res.warning) {
        setWarning(res.warning);
      } else {
        setMessage(`Reconnected ${PLATFORM_META[res.connection.platform].name}. Imported ${res.importedPosts} new posts.`);
      }
      load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Couldn't reconnect. Try again.");
    } finally {
      setReconnectingId(null);
    }
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
          {warning && (
            <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300">
              {warning}
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
        <h2 ref={listHeadingRef} tabIndex={-1} className="mb-4 font-bold text-slate-900 outline-none dark:text-white">
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
            {connections.map((c) => {
              const statusBadge = STATUS_BADGE[c.status] ?? STATUS_BADGE.error;
              return (
                <div
                  key={c.id}
                  className="rounded-xl border border-slate-100 p-3.5 transition hover:border-slate-200 dark:border-slate-800 dark:hover:border-slate-700"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3.5">
                      <PlatformGlyph platform={c.platform} className="h-10 w-10 shrink-0" />
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-slate-800 dark:text-slate-100">{c.handle}</div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {PLATFORM_META[c.platform].name}
                          {c.instance ? ` · ${c.instance}` : ""}
                          {" · "}
                          {c.lastSyncedAt ? `Synced ${timeAgo(c.lastSyncedAt)}` : "Not synced yet"}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={statusBadge.className}>
                        <span className={`h-1.5 w-1.5 rounded-full ${statusBadge.dot}`} />
                        {c.status}
                      </span>
                      <button
                        onClick={() => startReconnect(c)}
                        // aria-disabled (with a guard in startReconnect) instead
                        // of disabled: a disabled element can't receive the
                        // dialog's focus restore, silently dropping keyboard
                        // focus to <body> after a confirmed reconnect.
                        aria-disabled={reconnectingId === c.id}
                        className={`btn-ghost px-2.5 py-1.5 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 ${
                          reconnectingId === c.id ? "cursor-not-allowed opacity-50" : ""
                        }`}
                      >
                        {reconnectingId === c.id ? "Reconnecting…" : "Reconnect"}
                      </button>
                      <button
                        onClick={() => setDialog({ kind: "disconnect", connection: c })}
                        className="btn-ghost px-2.5 py-1.5 text-sm text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>
                  {c.lastError && (
                    <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-inset ring-rose-600/15 dark:bg-rose-500/10 dark:text-rose-400">
                      Error: {c.lastError}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {dialog?.kind === "disconnect" && (
        <ConnectionDialog
          title={`Disconnect ${PLATFORM_META[dialog.connection.platform].name}?`}
          description={`${dialog.connection.handle} will be removed from NEXUS. Posts already in your feed stay, but this platform stops syncing and publishing until you connect it again.`}
          confirmLabel="Disconnect"
          destructive
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            const id = dialog.connection.id;
            setDialog(null);
            await disconnect(id);
            // The dialog's focus-restore target (the row's Disconnect
            // button) unmounts with the row — land focus on the list
            // heading instead of letting it fall to <body>.
            listHeadingRef.current?.focus();
          }}
        />
      )}
      {dialog?.kind === "reconnect" && (
        <ConnectionDialog
          title={`Reconnect ${PLATFORM_META[dialog.connection.platform].name}`}
          description={`Enter a new app password for ${dialog.connection.handle}. It replaces the stored one and is encrypted before it's saved.`}
          confirmLabel="Reconnect"
          credentialLabel="App password (demo: any value)"
          onCancel={() => setDialog(null)}
          onConfirm={async (newCredential) => {
            const id = dialog.connection.id;
            setDialog(null);
            await runReconnect(id, newCredential || undefined);
          }}
        />
      )}
    </div>
  );
}

/**
 * Small confirm dialog used for disconnect confirmation and app-password
 * reconnect. Accessible: role=dialog + aria-modal, labelled by its title,
 * focus moves in on open and returns to the previously focused element on
 * close, Escape cancels, and Tab cycles within the dialog.
 */
function ConnectionDialog(props: {
  title: string;
  description: string;
  confirmLabel: string;
  credentialLabel?: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: (credential: string) => void | Promise<void>;
}) {
  const { title, description, confirmLabel, credentialLabel, destructive, onCancel, onConfirm } = props;
  const [credential, setCredential] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = "connection-dialog-title";

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
        onCancel();
        return;
      }
      if (e.key === "Tab") {
        const items = focusables();
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        // Clicking non-interactive dialog text drops DOM focus to <body>;
        // without this containment branch the next Tab would walk into the
        // obscured page behind the backdrop despite aria-modal.
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
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4 pt-32 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="card animate-fade-up w-full max-w-md p-6 outline-none"
      >
        <h2 id={titleId} className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
          {title}
        </h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{description}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm(credential);
          }}
        >
          {credentialLabel && (
            <div className="mt-4">
              <label className="label" htmlFor="connection-dialog-credential">
                {credentialLabel}
              </label>
              <input
                id="connection-dialog-credential"
                className="input"
                type="password"
                value={credential}
                onChange={(e) => setCredential(e.target.value)}
                placeholder="xxxx-xxxx-xxxx-xxxx"
              />
            </div>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onCancel} className="btn-outline">
              Cancel
            </button>
            <button
              type="submit"
              className={
                destructive
                  ? "btn inline-flex bg-rose-600 text-white shadow-sm hover:bg-rose-500 focus-visible:ring-rose-400"
                  : "btn-primary"
              }
            >
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
