"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const { user, setUser, refresh } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [sendingVerification, setSendingVerification] = useState(false);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
      setBio(user.bio);
      setTheme(user.theme);
    }
  }, [user]);

  // Returning from the "click the link in your email" verification flow
  // (routes/accountRecovery.ts's GET /api/auth/email/verify redirects here)
  // — surface the result once, refresh the user so the badge below updates
  // immediately, then strip the query params so a reload doesn't re-show it.
  useEffect(() => {
    const verified = searchParams.get("emailVerified");
    const verifyErr = searchParams.get("emailVerifyError");
    if (verified) {
      setVerifyMessage("Email verified!");
      void refresh();
      router.replace("/dashboard/settings");
    } else if (verifyErr) {
      setVerifyError(verifyErr);
      router.replace("/dashboard/settings");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setError(null);
    setSaving(true);
    try {
      const { user } = await api.updateProfile({ displayName, bio, theme });
      setUser(user);
      setMessage("Profile updated.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const resendVerification = async () => {
    setVerifyMessage(null);
    setVerifyError(null);
    setSendingVerification(true);
    try {
      const res = await api.requestEmailVerification();
      setVerifyMessage(res.alreadyVerified ? "Already verified." : "Verification email sent — check your inbox.");
    } catch (err) {
      setVerifyError(err instanceof ApiError ? err.message : "Failed to send verification email");
    } finally {
      setSendingVerification(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Settings</h1>
        <p className="text-sm text-slate-500">Manage your profile and preferences.</p>
      </div>

      <form onSubmit={save} className="card space-y-4 p-5">
        <div>
          <label className="label">Display name</label>
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div>
          <label className="label">Bio</label>
          <textarea className="input resize-none" rows={3} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={280} />
        </div>
        <div>
          <label className="label">Theme</label>
          <div className="flex gap-2">
            {(["light", "dark"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium capitalize transition ${
                  theme === t
                    ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200"
                    : "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300"
                }`}
              >
                {t === "light" ? "☀️ Light" : "🌙 Dark"}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        {message && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>}
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </form>

      <div className="card space-y-3 p-5">
        <h2 className="font-bold text-slate-900 dark:text-white">Account</h2>
        <p className="text-sm text-slate-500">
          Signed in as <span className="font-medium text-slate-700 dark:text-slate-200">{user?.email}</span>
        </p>

        <div className="flex items-center justify-between rounded-lg border border-slate-100 px-3.5 py-2.5 dark:border-slate-800">
          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Email verification</p>
            {user?.emailVerifiedAt ? (
              <p className="mt-0.5 text-xs text-emerald-600">Verified</p>
            ) : (
              <p className="mt-0.5 text-xs text-slate-500">Not verified yet</p>
            )}
          </div>
          {!user?.emailVerifiedAt && (
            <button
              type="button"
              onClick={resendVerification}
              className="btn-ghost px-3 py-1.5 text-sm text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30"
              disabled={sendingVerification}
            >
              {sendingVerification ? "Sending…" : "Resend email"}
            </button>
          )}
        </div>
        {verifyError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{verifyError}</p>}
        {verifyMessage && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{verifyMessage}</p>}
      </div>
    </div>
  );
}
