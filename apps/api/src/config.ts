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
};

// Platform metadata derived from the BRD (section 8: Platform Integration Specs).
export const PLATFORMS = {
  twitter: { id: "twitter", name: "Twitter / X", charLimit: 280, color: "#1d9bf0", auth: "oauth" },
  threads: { id: "threads", name: "Threads", charLimit: 500, color: "#000000", auth: "oauth" },
  bluesky: { id: "bluesky", name: "Bluesky", charLimit: 300, color: "#0085ff", auth: "app_password" },
  mastodon: { id: "mastodon", name: "Mastodon", charLimit: 500, color: "#6364ff", auth: "oauth" },
} as const;

export type PlatformId = keyof typeof PLATFORMS;

export const PLATFORM_IDS = Object.keys(PLATFORMS) as PlatformId[];

export function isPlatform(value: string): value is PlatformId {
  return value in PLATFORMS;
}
