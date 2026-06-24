import Link from "next/link";
import { PLATFORM_META, PLATFORM_ORDER, PlatformGlyph } from "@/lib/platforms";

const FEATURES = [
  { title: "Unified Feed", desc: "Every post from every network in one chronological timeline.", icon: "🗞️" },
  { title: "Cross-Platform Posting", desc: "Write once, publish to all your platforms with a single click.", icon: "🚀" },
  { title: "Centralized Management", desc: "Manage all connected accounts from a single dashboard.", icon: "🎛️" },
  { title: "Privacy-First", desc: "Your tokens are encrypted and your data stays yours.", icon: "🔒" },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-brand-50">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 text-xl font-extrabold text-slate-900">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">N</span>
          NEXUS
        </div>
        <nav className="flex items-center gap-3">
          <Link href="/login" className="btn-ghost">
            Log in
          </Link>
          <Link href="/register" className="btn-primary">
            Get started
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-4xl px-6 pb-12 pt-16 text-center">
        <div className="mb-6 flex justify-center gap-2">
          {PLATFORM_ORDER.map((p) => (
            <PlatformGlyph key={p} platform={p} className="h-10 w-10 text-sm" />
          ))}
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-6xl">
          All your social media,
          <span className="text-brand-600"> one feed.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
          Connect Twitter, Threads, Bluesky, and Mastodon. View a single unified feed, engage with
          everything in one place, and cross-post to every network at once.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/register" className="btn-primary px-6 py-3 text-base">
            Create your account
          </Link>
          <Link href="/login" className="btn-outline px-6 py-3 text-base">
            Try the demo
          </Link>
        </div>
        <p className="mt-3 text-sm text-slate-500">
          Demo login: <span className="font-mono">demo@nexus.app</span> /{" "}
          <span className="font-mono">password123</span>
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="card p-6">
              <div className="mb-3 text-3xl">{f.icon}</div>
              <h3 className="text-lg font-bold text-slate-900">{f.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <h2 className="mb-6 text-center text-2xl font-bold text-slate-900">Supported platforms</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PLATFORM_ORDER.map((p) => (
            <div key={p} className="card flex items-center gap-3 p-5">
              <PlatformGlyph platform={p} className="h-12 w-12 text-base" />
              <div>
                <div className="font-semibold text-slate-900">{PLATFORM_META[p].name}</div>
                <div className="text-sm text-slate-500">
                  {PLATFORM_META[p].charLimit} chars · {PLATFORM_META[p].authLabel}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-slate-200 py-8 text-center text-sm text-slate-500">
        NEXUS — Social Media Aggregator Platform · Built from the BRD v1.0
      </footer>
    </main>
  );
}
