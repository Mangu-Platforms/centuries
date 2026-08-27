import { describe, expect, it } from "vitest";

// Phase C7: capability descriptor on the connector seam. Networks differ
// in what they support (threads, replies, native media, like-mirroring),
// so the UI must capability-gate actions per connector instead of
// pretending uniformity. Capabilities are derived from which optional
// methods a connector actually implements — no separate registry to
// drift out of sync.

const { capabilitiesOf } = await import("../connectors/types.js");
const { getConnector } = await import("../connectors/registry.js");
const { wrapConnector } = await import("../lib/resilience.js");

describe("connector capabilities (C7)", () => {
  it("derives capabilities from the optional methods a connector implements", () => {
    const bare = {
      platform: "twitter" as const,
      fetchTimeline: async () => [],
      publish: async () => ({ externalId: "x", latencyMs: 0 }),
    };
    expect(capabilitiesOf(bare)).toEqual({ thread: false, reply: false });

    const threaded = {
      ...bare,
      fetchThread: async () => [],
      publishReply: async () => ({ externalId: "r", latencyMs: 0 }),
    };
    expect(capabilitiesOf(threaded)).toEqual({ thread: true, reply: true });
  });

  it("demo connectors support threads (deterministic demo replies)", async () => {
    const demo = getConnector("twitter", false);
    expect(capabilitiesOf(demo).thread).toBe(true);

    const timeline = await demo.fetchTimeline({ handle: "@capdemo" }, 3);
    const thread = await demo.fetchThread!({ handle: "@capdemo" }, timeline[0].externalId);
    // Root post first, then at least one reply; deterministic for the
    // same externalId.
    expect(thread.length).toBeGreaterThan(1);
    expect(thread[0].externalId).toBe(timeline[0].externalId);
    const again = await demo.fetchThread!({ handle: "@capdemo" }, timeline[0].externalId);
    expect(again.map((p) => p.externalId)).toEqual(thread.map((p) => p.externalId));
    // Replies reference real-looking authors and content.
    for (const reply of thread.slice(1)) {
      expect(reply.authorHandle).toMatch(/^@/);
      expect(reply.content.length).toBeGreaterThan(0);
    }
  });

  it("the resilience wrapper preserves capabilities and guards fetchThread like fetchTimeline", async () => {
    let calls = 0;
    const flaky = {
      platform: "bluesky" as const,
      fetchTimeline: async () => [],
      publish: async () => ({ externalId: "x", latencyMs: 0 }),
      fetchThread: async () => {
        calls++;
        if (calls === 1) {
          const err = new Error("HTTP 502") as Error & { status: number };
          err.status = 502;
          throw err;
        }
        return [];
      },
    };
    const wrapped = wrapConnector(flaky, { backoffBaseMs: 5, backoffCapMs: 10 });
    expect(capabilitiesOf(wrapped).thread).toBe(true);
    await wrapped.fetchThread!({ handle: "@x", connectionId: "cap-wrap-test" }, "ext-1");
    expect(calls).toBe(2); // retried the transient 502
  });

  it("a connector without fetchThread stays thread-incapable through the wrapper", () => {
    const bare = {
      platform: "twitter" as const,
      fetchTimeline: async () => [],
      publish: async () => ({ externalId: "x", latencyMs: 0 }),
    };
    const wrapped = wrapConnector(bare, {});
    expect(capabilitiesOf(wrapped).thread).toBe(false);
    expect(wrapped.fetchThread).toBeUndefined();
  });
});
