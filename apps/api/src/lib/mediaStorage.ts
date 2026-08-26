import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "../config.js";

export interface StoredMedia {
  url: string;
  key: string;
}

export interface MediaStorage {
  store(buffer: Buffer, mimeType: string): Promise<StoredMedia>;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

export const ALLOWED_MEDIA_MIME_TYPES = Object.keys(EXT_BY_MIME);

const UPLOAD_DIR = process.env.MEDIA_UPLOAD_DIR || path.resolve(process.cwd(), "uploads");

/** Resolves a storage key to its on-disk path — shared with the GET /uploads/:key serving route. */
export function localUploadPath(key: string): string {
  return path.join(UPLOAD_DIR, key);
}

// Local-disk storage (Phase E3): the only implementation today, same
// "ship a fully-working default, gate the real provider behind env" split
// as ConsoleEmailProvider (Phase B2) — S3-compatible storage needs a real
// bucket + credentials nobody has supplied yet (parked WAITING-ON-HUMAN as
// E3a in BACKLOG.md). Swapping one in later is a new MediaStorage
// implementation; nothing above this interface (the upload route) needs
// to change.
//
// Every uploaded file gets a random UUID-based filename — never the
// client-supplied name — so the serving route can trust a key matching
// the expected pattern is safe to read straight off disk (no path
// traversal risk), and so two users' same-named uploads never collide.
export class LocalDiskStorage implements MediaStorage {
  async store(buffer: Buffer, mimeType: string): Promise<StoredMedia> {
    const ext = EXT_BY_MIME[mimeType];
    if (!ext) throw new Error(`Unsupported media type: ${mimeType}`);
    const key = `${crypto.randomUUID()}.${ext}`;
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(localUploadPath(key), buffer);
    return { url: `${config.apiPublicUrl}/uploads/${key}`, key };
  }
}

let storage: MediaStorage = new LocalDiskStorage();

/** Test seam — swap the active storage without touching call sites (mirrors lib/email.ts). */
export function setMediaStorage(next: MediaStorage): void {
  storage = next;
}

export async function storeMedia(buffer: Buffer, mimeType: string): Promise<StoredMedia> {
  return storage.store(buffer, mimeType);
}
