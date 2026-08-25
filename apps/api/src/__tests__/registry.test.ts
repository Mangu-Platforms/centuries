import { afterEach, describe, expect, it } from "vitest";
import { getConnector, hasLiveConnector, registerLiveConnector, __resetRegistryForTests } from "../connectors/registry.js";
import { getConnector as getDemoConnector } from "../connectors/demo.js";
import type { PlatformConnector } from "../connectors/types.js";

afterEach(() => {
  __resetRegistryForTests();
});

function fakeLiveConnector(platform: "bluesky"): PlatformConnector {
  return {
    platform,
    async fetchTimeline() {
      return [];
    },
    async publish() {
      return { externalId: "live-post-1", latencyMs: 1 };
    },
  };
}

describe("connector registry", () => {
  it("falls back to the demo connector when no live connector is registered", () => {
    const connector = getConnector("bluesky", true);
    expect(connector.platform).toBe("bluesky");
    expect(connector).toBe(getDemoConnector("bluesky"));
  });

  it("stays on the demo connector when a live connector exists but the caller has no credentials", () => {
    registerLiveConnector("bluesky", () => fakeLiveConnector("bluesky"));
    const connector = getConnector("bluesky", false);
    expect(connector).toBe(getDemoConnector("bluesky"));
  });

  it("uses the live connector once one is registered and credentials are present", async () => {
    registerLiveConnector("bluesky", () => fakeLiveConnector("bluesky"));
    const connector = getConnector("bluesky", true);
    expect(connector).not.toBe(getDemoConnector("bluesky"));
    const result = await connector.publish({ handle: "@x.bsky.social" }, "hello", []);
    expect(result.externalId).toBe("live-post-1");
  });

  it("reports whether a live connector is registered independent of credentials", () => {
    expect(hasLiveConnector("bluesky")).toBe(false);
    registerLiveConnector("bluesky", () => fakeLiveConnector("bluesky"));
    expect(hasLiveConnector("bluesky")).toBe(true);
  });
});
