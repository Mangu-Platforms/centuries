import { describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import { reportError } from "../lib/errorReporting.js";

function fakeLogger(): FastifyBaseLogger {
  return { error: vi.fn() } as unknown as FastifyBaseLogger;
}

describe("lib/errorReporting", () => {
  it("logs the error merged with request context via the provided logger", () => {
    const logger = fakeLogger();
    const err = new Error("boom");
    reportError(logger, err, {
      requestId: "req-1",
      method: "POST",
      url: "/api/posts",
      statusCode: 500,
    });

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [payload, message] = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(message).toBe("Unhandled error");
    expect(payload).toMatchObject({
      err,
      requestId: "req-1",
      method: "POST",
      url: "/api/posts",
      statusCode: 500,
    });
  });

  it("passes through a non-Error thrown value unchanged", () => {
    const logger = fakeLogger();
    reportError(logger, "a string throw", {
      requestId: "req-2",
      method: "GET",
      url: "/api/feed",
      statusCode: 500,
    });

    const [payload] = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload.err).toBe("a string throw");
  });
});
