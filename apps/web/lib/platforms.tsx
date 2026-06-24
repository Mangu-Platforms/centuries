import type { PlatformId } from "./types";

export const PLATFORM_META: Record<
  PlatformId,
  { name: string; color: string; charLimit: number; authLabel: string }
> = {
  twitter: { name: "Twitter / X", color: "#1d9bf0", charLimit: 280, authLabel: "OAuth 2.0" },
  threads: { name: "Threads", color: "#000000", charLimit: 500, authLabel: "Instagram OAuth" },
  bluesky: { name: "Bluesky", color: "#0085ff", charLimit: 300, authLabel: "App password" },
  mastodon: { name: "Mastodon", color: "#6364ff", charLimit: 500, authLabel: "OAuth 2.0" },
};

export const PLATFORM_ORDER: PlatformId[] = ["twitter", "threads", "bluesky", "mastodon"];

export function PlatformGlyph({ platform, className = "" }: { platform: PlatformId; className?: string }) {
  const letter: Record<PlatformId, string> = {
    twitter: "X",
    threads: "@",
    bluesky: "B",
    mastodon: "M",
  };
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-bold text-white ${className}`}
      style={{ backgroundColor: PLATFORM_META[platform].color }}
      title={PLATFORM_META[platform].name}
    >
      {letter[platform]}
    </span>
  );
}
