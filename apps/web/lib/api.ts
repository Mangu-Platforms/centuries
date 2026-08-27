import type {
  AnalyticsData,
  Connection,
  DashboardData,
  FeedPost,
  Platform,
  PublishHistoryItem,
  PublishTargetResult,
  SessionInfo,
  User,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const TOKEN_KEY = "nexus_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Access tokens are short-lived (15 minutes, see routes/auth.ts). The
// long-lived credential is an httpOnly refresh cookie the browser sends
// automatically (hence `credentials: "include"` below) — this module
// never reads or stores it directly. On a 401, silently exchange it for a
// fresh access token and retry the request once, so an expired token
// never surfaces as a logout the user notices. Login's own 401 (wrong
// password) must never trigger this — it isn't a session expiring.
const AUTH_RETRY_EXEMPT_PATHS = new Set(["/api/auth/login"]);

let refreshPromise: Promise<boolean> | null = null;

// Concurrent 401s (e.g. several components fetching on mount) must share
// one in-flight refresh rather than each firing their own: the refresh
// token rotates on use, so two independent refresh calls with the same
// stale cookie would have the second one look like a replay of an
// already-used token and revoke the user's own session.
function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_URL}/api/auth/refresh`, { method: "POST", credentials: "include" })
      .then(async (res) => {
        if (!res.ok) return false;
        const body = await res.json();
        setToken(body.token);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// Media upload (Phase E3) can't go through request(): it sends a File via
// FormData, not a JSON body, so it must skip the JSON content-type header
// (the browser sets multipart's own boundary-bearing one) while still
// sharing request()'s auth-token attachment and single-retry-on-401 logic.
async function uploadMedia(file: File, isRetry = false): Promise<{ url: string; key: string }> {
  const token = getToken();
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_URL}/api/media/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: "include",
    body: formData,
  });

  if (res.status === 401 && !isRetry) {
    const refreshed = await tryRefresh();
    if (refreshed) return uploadMedia(file, true);
    clearToken();
  }

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : null;

  if (!res.ok) {
    const message = (body && (body.error || body.message)) || `Upload failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return body as { url: string; key: string };
}

async function request<T>(path: string, options: RequestInit = {}, isRetry = false): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    // Only claim a JSON body when there actually is one: Fastify rejects a
    // body-less POST that carries Content-Type: application/json with
    // FST_ERR_CTP_EMPTY_JSON_BODY (400) — which silently broke every
    // body-less POST here (like, bookmark, logout, logout-all, resend
    // verification) until E7's retry endpoint surfaced it.
    ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: "include" });

  if (res.status === 401 && !isRetry && !AUTH_RETRY_EXEMPT_PATHS.has(path)) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, options, true);
    clearToken();
  }

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : null;

  if (!res.ok) {
    const message = (body && (body.error || body.message)) || `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return body as T;
}

export const api = {
  register: (email: string, password: string, displayName: string) =>
    request<{ token: string; user: User }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, displayName }),
    }),

  login: (email: string, password: string) =>
    request<{ token: string; user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  me: () => request<{ user: User }>("/api/auth/me"),

  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),

  requestPasswordReset: (email: string) =>
    request<{ ok: boolean }>("/api/auth/password-reset/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  confirmPasswordReset: (token: string, newPassword: string) =>
    request<{ ok: boolean }>("/api/auth/password-reset/confirm", {
      method: "POST",
      body: JSON.stringify({ token, newPassword }),
    }),

  requestEmailVerification: () =>
    request<{ ok: boolean; alreadyVerified?: boolean }>("/api/auth/email/verify/request", { method: "POST" }),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  sessions: () => request<{ sessions: SessionInfo[] }>("/api/auth/sessions"),

  revokeSession: (id: string) => request<{ ok: boolean }>(`/api/auth/sessions/${id}`, { method: "DELETE" }),

  logoutAllOtherSessions: () =>
    request<{ ok: boolean; revoked: number }>("/api/auth/sessions/logout-all", { method: "POST" }),

  updateProfile: (data: Partial<Pick<User, "displayName" | "bio" | "theme">>) =>
    request<{ user: User }>("/api/auth/me", { method: "PATCH", body: JSON.stringify(data) }),

  platforms: () => request<{ platforms: Platform[] }>("/api/platforms"),

  connections: () => request<{ connections: Connection[] }>("/api/connections"),

  connect: (platform: string, handle: string, instance?: string, credential?: string) =>
    request<{ connection: Connection; importedPosts: number; warning?: string }>("/api/connections", {
      method: "POST",
      body: JSON.stringify({ platform, handle, instance, credential }),
    }),

  reconnect: (id: string, credential?: string) =>
    request<{ connection: Connection; importedPosts: number; warning?: string }>(
      `/api/connections/${id}/reconnect`,
      { method: "POST", body: JSON.stringify(credential ? { credential } : {}) },
    ),

  disconnect: (id: string) =>
    request<{ ok: boolean }>(`/api/connections/${id}`, { method: "DELETE" }),

  mastodonRegister: (instance: string) =>
    request<{ authorizeUrl: string }>("/api/connections/mastodon/register", {
      method: "POST",
      body: JSON.stringify({ instance }),
    }),

  feed: (params: { cursor?: string; platform?: string; search?: string; bookmarked?: boolean } = {}) => {
    const q = new URLSearchParams();
    if (params.cursor) q.set("cursor", params.cursor);
    if (params.platform) q.set("platform", params.platform);
    if (params.search) q.set("search", params.search);
    if (params.bookmarked) q.set("bookmarked", "true");
    const qs = q.toString();
    return request<{ posts: FeedPost[]; nextCursor: string | null }>(`/api/feed${qs ? `?${qs}` : ""}`);
  },

  like: (id: string) => request<{ post: FeedPost }>(`/api/feed/${id}/like`, { method: "POST" }),

  bookmark: (id: string) =>
    request<{ post: FeedPost }>(`/api/feed/${id}/bookmark`, { method: "POST" }),

  uploadMedia: (file: File) => uploadMedia(file),

  publish: (
    content: string,
    platforms: string[],
    mediaUrls: string[] = [],
    idempotencyKey?: string,
    scheduledAt?: string,
  ) =>
    request<{ jobId: string; results: PublishTargetResult[] }>("/api/posts", {
      method: "POST",
      body: JSON.stringify({ content, platforms, mediaUrls, idempotencyKey, scheduledAt }),
    }),

  cancelPost: (jobId: string) =>
    request<{ ok: boolean }>(`/api/posts/${jobId}`, { method: "DELETE" }),

  editPost: (jobId: string, data: { content?: string; scheduledAt?: string }) =>
    request<{ job: { id: string; content: string; scheduledAt: string | null } }>(
      `/api/posts/${jobId}`,
      { method: "PATCH", body: JSON.stringify(data) },
    ),

  retryPost: (jobId: string) =>
    request<{ jobId: string; retried: number; results: PublishTargetResult[] }>(
      `/api/posts/${jobId}/retry`,
      { method: "POST" },
    ),

  history: () => request<{ jobs: PublishHistoryItem[] }>("/api/posts/history"),

  dashboard: () => request<DashboardData>("/api/dashboard"),

  analytics: () => request<AnalyticsData>("/api/analytics"),
};
