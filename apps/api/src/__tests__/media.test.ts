import crypto from "node:crypto";
import { unlink } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";
import { localUploadPath } from "../lib/mediaStorage.js";

function uniqueEmail(): string {
  return `media-test-${crypto.randomUUID()}@nexus.app`;
}

async function register(app: Awaited<ReturnType<typeof buildApp>>): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: uniqueEmail(), password: "password123", displayName: "Media Test" },
  });
  return res.json().token as string;
}

// Hand-builds a real multipart/form-data body — light-my-request's inject()
// takes a raw payload, so this exercises the exact wire format
// @fastify/multipart parses rather than mocking the parser away.
function multipartBody(
  fieldName: string,
  filename: string,
  contentType: string,
  data: Buffer,
): { body: Buffer; headerContentType: string } {
  const boundary = `----mediaTest${crypto.randomUUID().replace(/-/g, "")}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, data, tail]), headerContentType: `multipart/form-data; boundary=${boundary}` };
}

// A real (tiny, valid) 1x1 transparent PNG — not just arbitrary bytes with
// a spoofed content-type, so the round-trip test proves actual image bytes
// survive the upload/store/serve path unchanged.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("Phase E3: media upload", () => {
  const createdKeys: string[] = [];

  afterEach(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "media-test-" } } });
    await Promise.all(createdKeys.splice(0).map((key) => unlink(localUploadPath(key)).catch(() => {})));
  });

  it("rejects an unauthenticated upload", async () => {
    const app = await buildApp();
    const { body, headerContentType } = multipartBody("file", "a.png", "image/png", PNG_1X1);
    const res = await app.inject({
      method: "POST",
      url: "/api/media/upload",
      headers: { "content-type": headerContentType },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it("uploads an image and serves it back byte-for-byte", async () => {
    const app = await buildApp();
    const token = await register(app);
    const { body, headerContentType } = multipartBody("file", "a.png", "image/png", PNG_1X1);

    const uploadRes = await app.inject({
      method: "POST",
      url: "/api/media/upload",
      headers: { authorization: `Bearer ${token}`, "content-type": headerContentType },
      payload: body,
    });
    expect(uploadRes.statusCode).toBe(201);
    const { url, key } = uploadRes.json();
    createdKeys.push(key);
    expect(key).toMatch(/\.png$/);
    expect(url).toContain(`/uploads/${key}`);

    const servedRes = await app.inject({ method: "GET", url: new URL(url).pathname });
    expect(servedRes.statusCode).toBe(200);
    expect(servedRes.headers["content-type"]).toBe("image/png");
    expect(servedRes.headers["cache-control"]).toContain("immutable");
    expect(Buffer.compare(servedRes.rawPayload, PNG_1X1)).toBe(0);
  });

  it("rejects an unsupported file type", async () => {
    const app = await buildApp();
    const token = await register(app);
    const { body, headerContentType } = multipartBody("file", "a.txt", "text/plain", Buffer.from("not an image"));

    const res = await app.inject({
      method: "POST",
      url: "/api/media/upload",
      headers: { authorization: `Bearer ${token}`, "content-type": headerContentType },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Unsupported file type/);
  });

  it("rejects a file over the 10MB limit", async () => {
    const app = await buildApp();
    const token = await register(app);
    const oversized = Buffer.alloc(11 * 1024 * 1024, 1);
    const { body, headerContentType } = multipartBody("file", "big.png", "image/png", oversized);

    const res = await app.inject({
      method: "POST",
      url: "/api/media/upload",
      headers: { authorization: `Bearer ${token}`, "content-type": headerContentType },
      payload: body,
    });
    expect(res.statusCode).toBe(413);
  });

  it("rejects an upload with no file field", async () => {
    const app = await buildApp();
    const token = await register(app);
    const boundary = `----mediaTestEmpty${crypto.randomUUID()}`;
    const res = await app.inject({
      method: "POST",
      url: "/api/media/upload",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.from(`--${boundary}--\r\n`),
    });
    expect(res.statusCode).toBe(400);
  });

  it("404s a well-formed but nonexistent key, 400s a malformed one", async () => {
    const app = await buildApp();
    const missing = await app.inject({ method: "GET", url: `/uploads/${crypto.randomUUID()}.png` });
    expect(missing.statusCode).toBe(404);

    // Single path segment, doesn't match the strict UUID.ext pattern —
    // covers the same rejection a traversal attempt (e.g. "..%2Fsecret")
    // would hit, without depending on how the router normalizes "..".
    const malformed = await app.inject({ method: "GET", url: "/uploads/not-a-real-key.png" });
    expect(malformed.statusCode).toBe(400);
  });
});
