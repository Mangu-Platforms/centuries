import Link from "next/link";
import { PLATFORM_META, PLATFORM_ORDER, PlatformGlyph } from "@/lib/platforms";

const FEATURES = [
  {
    title: "Unified Feed",
    desc: "Every post from every network, merged into one clean chronological timeline.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M4 6h16M4 12h16M4 18h10" />
      </svg>
    ),
  },
  {
    title: "Cross-Platform Posting",
    desc: "Write once, hit publish, and reach every platform in a single click.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
      </svg>
    ),
  },
  {
    title: "Centralized Management",
    desc: "Connect, monitor, and manage every account from one calm dashboard.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    ),
  },
  {
    title: "Privacy-First",
    desc: "Your credentials and data stay yours. No ads, no tracking, no noise.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
];

function Logo() {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow-md shadow-brand-600/30">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M6 20V4l12 16V4" />
      </svg>
    </span>
  );
}

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[640px] bg-hero-grid" />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-gradient-to-r from-brand-200/50 via-violet-200/40 to-fuchsia-200/40 blur-3xl" />

      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5 text-xl font-extrabold tracking-tight text-slate-900">
          <Logo />
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

      <section className="relative mx-auto max-w-4xl px-6 pb-16 pt-20 text-center">
        <div className="animate-fade-up mb-8 flex justify-center">
          <div className="flex items-center -space-x-2">
            {PLATFORM_ORDER.map((p) => (
              <PlatformGlyph key={p} platform={p} className="h-11 w-11 ring-4 ring-white" />
            ))}
          </div>
        </div>

        <div className="animate-fade-up mb-6 flex justify-center" style={{ animationDelay: "60ms" }}>
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3.5 py-1 text-xs font-semibold text-brand-700">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Four networks, one command center
          </span>
        </div>

        <h1 className="animate-fade-up text-5xl font-extrabold tracking-tight text-slate-900 sm:text-7xl" style={{ animationDelay: "120ms" }}>
          All your social media,
          <br />
          <span className="text-gradient-brand">one feed.</span>
        </h1>

        <p className="animate-fade-up mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-600" style={{ animationDelay: "180ms" }}>
          Connect Twitter, Threads, Bluesky, and Mastodon. Read a single unified timeline, engage
          with everything in one place, and cross-post to every network at once.
        </p>

        <div className="animate-fade-up mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row" style={{ animationDelay: "240ms" }}>
          <Link href="/register" className="btn-primary px-7 py-3 text-base">
            Create your account
          </Link>
          <Link href="/login" className="btn-outline px-7 py-3 text-base">
            Try the live demo
          </Link>
        </div>
        <p className="animate-fade-up mt-4 text-sm text-slate-500" style={{ animationDelay: "300ms" }}>
          Demo login: <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-slate-700">demo@nexus.app</span>{" "}
          / <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-slate-700">password123</span>
        </p>
      </section>

      <section className="relative mx-auto max-w-6xl px-6 pb-20">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="card card-hover p-6">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                {f.icon}
              </div>
              <h3 className="text-base font-bold text-slate-900">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="relative mx-auto max-w-6xl px-6 pb-24">
        <p className="section-title mb-2 text-center">Integrations</p>
        <h2 className="mb-8 text-center text-3xl font-bold tracking-tight text-slate-900">
          Supported platforms
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PLATFORM_ORDER.map((p) => (
            <div key={p} className="card card-hover flex items-center gap-4 p-5">
              <PlatformGlyph platform={p} className="h-12 w-12" />
              <div>
                <div className="font-bold text-slate-900">{PLATFORM_META[p].name}</div>
                <div className="mt-0.5 text-sm text-slate-500">
                  {PLATFORM_META[p].charLimit} chars · {PLATFORM_META[p].authLabel}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="relative border-t border-slate-200/80 py-8 text-center text-sm text-slate-500">
        <span className="font-semibold text-slate-700">NEXUS</span> — Social Media Aggregator
        Platform · Built from the BRD v1.0
      </footer>
    </main>
  );
}
