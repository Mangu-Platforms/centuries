import process from "node:process";

export const config = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "0.0.0.0",
  jwtSecret: process.env.JWT_SECRET ?? "dev-super-secret-change-me",
  corsOrigin: (process.env.CORS_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  isProd: process.env.NODE_ENV === "production",
  // 32-byte (64 hex char) key for encrypting connector credentials at rest.
  // See src/lib/crypto.ts for the dev-only fallback used when unset.
  dataKey: process.env.DATA_KEY ?? "",
  // This API's own publicly reachable base URL — used to build OAuth
  // redirect_uri values registered with third-party services (Phase C2+).
  apiPublicUrl: (process.env.API_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 4000}`).replace(/\/+$/, ""),
  // The web app's base URL — used as an OAuth flow's final redirect target
  // and as the "website" field on dynamically-registered OAuth apps.
  // Defaults to the first configured CORS origin, since in practice this
  // app has exactly one web origin per deployment.
  webAppUrl: (
    process.env.WEB_APP_URL ??
    (process.env.CORS_ORIGIN ?? "http://localhost:3000").split(",")[0].trim()
  ).replace(/\/+$/, ""),
  // Shared secret an external cron must present to POST /internal/tick
  // (Phase E2). See src/routes/internal.ts for the dev-only fallback used
  // when unset.
  cronSecret: process.env.CRON_SECRET ?? "",
};

// Platform metadata derived from the BRD (section 8: Platform Integration Specs).
export const PLATFORMS = {
  twitter: { id: "twitter", name: "Twitter / X", charLimit: 280, color: "#1d9bf0", auth: "oauth" },
  threads: { id: "threads", name: "Threads", charLimit: 500, color: "#000000", auth: "oauth" },
  bluesky: { id: "bluesky", name: "Bluesky", charLimit: 300, color: "#0085ff", auth: "app_password" },
  mastodon: { id: "mastodon", name: "Mastodon", charLimit: 500, color: "#6364ff", auth: "oauth" },
  instagram: { id: "instagram", name: "Instagram", charLimit: 2200, color: "#E4405F", auth: "oauth" },
} as const;

export type PlatformId = keyof typeof PLATFORMS;

export const PLATFORM_IDS = Object.keys(PLATFORMS) as PlatformId[];

export function isPlatform(value: string): value is PlatformId {
  return value in PLATFORMS;
}
