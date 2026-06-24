import type {
  Connection,
  DashboardData,
  FeedPost,
  Platform,
  PublishHistoryItem,
  PublishTargetResult,
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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
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

  updateProfile: (data: Partial<Pick<User, "displayName" | "bio" | "theme">>) =>
    request<{ user: User }>("/api/auth/me", { method: "PATCH", body: JSON.stringify(data) }),

  platforms: () => request<{ platforms: Platform[] }>("/api/platforms"),

  connections: () => request<{ connections: Connection[] }>("/api/connections"),

  connect: (platform: string, handle: string, instance?: string, credential?: string) =>
    request<{ connection: Connection; importedPosts: number }>("/api/connections", {
      method: "POST",
      body: JSON.stringify({ platform, handle, instance, credential }),
    }),

  disconnect: (id: string) =>
    request<{ ok: boolean }>(`/api/connections/${id}`, { method: "DELETE" }),

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

  publish: (content: string, platforms: string[], mediaUrls: string[] = []) =>
    request<{ jobId: string; results: PublishTargetResult[] }>("/api/posts", {
      method: "POST",
      body: JSON.stringify({ content, platforms, mediaUrls }),
    }),

  history: () => request<{ jobs: PublishHistoryItem[] }>("/api/posts/history"),

  dashboard: () => request<DashboardData>("/api/dashboard"),
};
