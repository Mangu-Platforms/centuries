"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const justReset = searchParams.get("reset") === "1";
  const [email, setEmail] = useState("demo@nexus.app");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Phase B6: a 423 lockout carries retryAfterSeconds — surface it as a
  // live countdown instead of a static error the user retries against.
  const [lockoutSeconds, setLockoutSeconds] = useState(0);

  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const t = setTimeout(() => setLockoutSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [lockoutSeconds]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      router.push("/dashboard");
    } catch (err) {
      if (err instanceof ApiError && err.status === 423) {
        const retryAfter = (err.details as { retryAfterSeconds?: number } | null)?.retryAfterSeconds;
        if (typeof retryAfter === "number" && retryAfter > 0) setLockoutSeconds(retryAfter);
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : "Login failed");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-white to-brand-50 px-4">
      <div className="card w-full max-w-md p-8">
        <Link href="/" className="mb-6 flex items-center gap-2 text-xl font-extrabold text-slate-900">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">N</span>
          NEXUS
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Welcome back</h1>
        <p className="mt-1 text-sm text-slate-500">Log in to your unified social dashboard.</p>

        {justReset && (
          <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            Password reset — log in with your new password.
          </p>
        )}

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <label className="label" htmlFor="password">Password</label>
              <Link href="/forgot-password" className="text-xs font-semibold text-brand-600 hover:underline">
                Forgot password?
              </Link>
            </div>
            <input id="password" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {lockoutSeconds > 0 ? (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="status" aria-live="polite">
              Account temporarily locked after too many failed attempts. Try again in{" "}
              <span className="font-semibold tabular-nums">{lockoutSeconds}s</span>.
            </p>
          ) : (
            error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          )}
          <button type="submit" className="btn-primary w-full py-2.5" disabled={loading || lockoutSeconds > 0}>
            {loading ? "Logging in…" : lockoutSeconds > 0 ? `Locked (${lockoutSeconds}s)` : "Log in"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          No account?{" "}
          <Link href="/register" className="font-semibold text-brand-600 hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}
