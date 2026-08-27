import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PLATFORMS, PLATFORM_IDS } from "../config.js";

// Phase A8: PLATFORMS (api/src/config.ts) and PLATFORM_META
// (web/lib/platforms.tsx) are deliberately hand-synced twins — two small
// maps don't justify a shared package yet (ARCHITECTURE.md), but drift
// between them has already bitten once (E5: Instagram missing from a
// hand-synced map crashed db:setup). This test makes drift a CI failure
// instead of a runtime surprise.
//
// The web file is parsed with a line regex rather than imported (it's a
// .tsx module with JSX and path aliases). Fail-closed by design: if the
// file's format changes and the regex stops matching, the id-set
// assertion below fails loudly — format drift is still drift.

const WEB_PLATFORMS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../web/lib/platforms.tsx",
);

interface WebEntry {
  name: string;
  color: string;
  charLimit: number;
  authKind: string;
}

function parseWebPlatformMeta(): Record<string, WebEntry> {
  const source = readFileSync(WEB_PLATFORMS_PATH, "utf8");
  const entries: Record<string, WebEntry> = {};
  const entryRe =
    /^\s*(\w+): \{ name: "([^"]+)", color: "([^"]+)", charLimit: (\d+), authLabel: "[^"]+", authKind: "(\w+)" \},$/gm;
  for (const m of source.matchAll(entryRe)) {
    entries[m[1]] = { name: m[2], color: m[3], charLimit: Number(m[4]), authKind: m[5] };
  }
  return entries;
}

describe("platform metadata parity (A8)", () => {
  const web = parseWebPlatformMeta();

  it("both sides define exactly the same platform ids", () => {
    expect(Object.keys(web).sort()).toEqual([...PLATFORM_IDS].sort());
  });

  it.each(PLATFORM_IDS.map((id) => [id] as const))("%s: name, color, charLimit, and auth kind match", (id) => {
    const api = PLATFORMS[id];
    const meta = web[id];
    expect(meta, `web PLATFORM_META has no entry for "${id}" (or its format changed)`).toBeDefined();
    expect(meta.name).toBe(api.name);
    expect(meta.color).toBe(api.color);
    expect(meta.charLimit).toBe(api.charLimit);
    expect(meta.authKind).toBe(api.auth);
  });
});
