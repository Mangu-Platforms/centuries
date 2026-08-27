import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createOAuthAPIClient, createRestAPIClient } from "masto";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { normalizeInstanceUrl } from "../connectors/mastodon.js";
import { getConnector } from "../connectors/registry.js";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";
import { importInitialTimeline } from "../lib/timelineImport.js";

// Mastodon's OAuth 2.0 authorization-code flow against a user-supplied
// instance (Phase C2). Two hops:
//   1. POST /api/connections/mastodon/register — authenticated (JWT). NEXUS
//      dynamically registers an OAuth app on the given instance, then hands
//      back an authorizeUrl for the browser to navigate to.
//   2. GET /api/connections/mastodon/callback — hit by the instance
//      redirecting the *browser*, not an authenticated fetch, so it can't
//      carry our JWT. Instead the state param (opaque, AES-256-GCM
//      encrypted with the same DATA_KEY as stored credentials) carries the
//      user id and the dynamically-registered app's client id/secret. This
//      avoids a new "pending OAuth attempt" DB table entirely — the state
//      round-trips through the instance and back, self-contained.

const OAUTH_SCOPES = "read write";
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — bounds how long a stale/replayed state is honored

const registerSchema = z.object({ instance: z.string().min(1).max(200) });

interface OAuthState {
  userId: string;
  instanceUrl: string;
  clientId: string;
  clientSecret: string;
  issuedAt: number;
}

function callbackRedirectUri(): string {
  return `${config.apiPublicUrl}/api/connections/mastodon/callback`;
}

function connectionsPageUrl(query: Record<string, string>): string {
  const url = new URL("/dashboard/connections", config.webAppUrl);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
}

export async function mastodonAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/connections/mastodon/register",
    // Rate-limited ahead of auth: this triggers an outbound dynamic app
    // registration against whatever instance is named, so it must be
    // bounded regardless of whether the caller's token is valid.
    { preHandler: [app.rateLimit({ max: 5, timeWindow: "1 minute" }), app.authenticate] },
    async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });

    const instanceUrl = normalizeInstanceUrl(parsed.data.instance);
    const redirectUri = callbackRedirectUri();

    let registered: { clientId?: string | null; clientSecret?: string | null };
    try {
      const anonymousClient = createRestAPIClient({ url: instanceUrl });
      registered = await anonymousClient.v1.apps.create({
        clientName: "NEXUS",
        redirectUris: redirectUri,
        scopes: OAUTH_SCOPES,
        website: config.webAppUrl,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return reply.code(400).send({ error: `Could not reach ${instanceUrl}: ${message}` });
    }
    if (!registered.clientId || !registered.clientSecret) {
      return reply.code(502).send({ error: "The Mastodon instance did not return OAuth app credentials" });
    }

    const state: OAuthState = {
      userId: request.user.sub,
      instanceUrl,
      clientId: registered.clientId,
      clientSecret: registered.clientSecret,
      issuedAt: Date.now(),
    };
    const encodedState = encryptSecret(JSON.stringify(state));

    const authorizeUrl = new URL("/oauth/authorize", instanceUrl);
    authorizeUrl.searchParams.set("client_id", registered.clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", OAUTH_SCOPES);
    authorizeUrl.searchParams.set("state", encodedState);

    return reply.send({ authorizeUrl: authorizeUrl.toString() });
    },
  );

  // No app.authenticate here by design: the instance redirects the user's
  // browser to this URL directly, which can't carry an Authorization
  // header. The encrypted `state` param is the only credential this route
  // trusts (see OAuthState above).
  app.get(
    "/api/connections/mastodon/callback",
    // No app.authenticate (see above), so this is the only guard against
    // abuse — bounds brute-force guessing against the encrypted `state`
    // param and repeated token-exchange attempts against the instance.
    { preHandler: [app.rateLimit({ max: 10, timeWindow: "1 minute" })] },
    async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string; error_description?: string };

    if (query.error) {
      return reply.redirect(
        connectionsPageUrl({ mastodonError: query.error_description || query.error }),
      );
    }
    if (!query.code || !query.state) {
      return reply.redirect(connectionsPageUrl({ mastodonError: "Missing authorization code" }));
    }

    let state: OAuthState;
    try {
      state = JSON.parse(decryptSecret(query.state)) as OAuthState;
    } catch {
      return reply.redirect(connectionsPageUrl({ mastodonError: "Invalid or tampered authorization state" }));
    }
    if (!state.userId || !state.instanceUrl || !state.clientId || !state.clientSecret) {
      return reply.redirect(connectionsPageUrl({ mastodonError: "Invalid authorization state" }));
    }
    if (Date.now() - state.issuedAt > STATE_TTL_MS) {
      return reply.redirect(connectionsPageUrl({ mastodonError: "Authorization expired — please try again" }));
    }

    try {
      const oauthClient = createOAuthAPIClient({ url: state.instanceUrl });
      const token = await oauthClient.token.create({
        grantType: "authorization_code",
        clientId: state.clientId,
        clientSecret: state.clientSecret,
        redirectUri: callbackRedirectUri(),
        code: query.code,
        scope: OAUTH_SCOPES,
      });

      const client = createRestAPIClient({ url: state.instanceUrl, accessToken: token.accessToken });
      const account = await client.v1.accounts.verifyCredentials();
      const host = new URL(state.instanceUrl).host;
      const acct = account.acct.includes("@") ? account.acct : `${account.username}@${host}`;
      const handle = "@" + acct;

      // An already-connected handle is a reconnect (Phase C6), not an
      // error: the user deliberately re-ran the OAuth flow (e.g. after
      // revoking NEXUS on the instance), so the fresh token replaces the
      // stale one and the connection heals. Discarding the new token here
      // would make Mastodon — the one platform whose reconnect requires
      // re-authorization — permanently unreconnectable.
      const existing = await prisma.connection.findUnique({
        where: { userId_platform_handle: { userId: state.userId, platform: "mastodon", handle } },
      });

      const connection = existing
        ? await prisma.connection.update({
            where: { id: existing.id },
            data: {
              displayName: account.displayName || account.username,
              instance: host,
              status: "active",
              lastError: "",
              accessTokenEnc: encryptSecret(token.accessToken),
              scopes: token.scope,
            },
          })
        : await prisma.connection.create({
            data: {
              userId: state.userId,
              platform: "mastodon",
              handle,
              displayName: account.displayName || account.username,
              instance: host,
              status: "active",
              accessTokenEnc: encryptSecret(token.accessToken),
              scopes: token.scope,
            },
          });

      const { importedPosts } = await importInitialTimeline({
        userId: state.userId,
        connectionId: connection.id,
        platform: "mastodon",
        connector: getConnector("mastodon", true),
        ctx: { handle, instance: host, accessToken: token.accessToken, connectionId: connection.id },
      });

      return reply.redirect(
        connectionsPageUrl({
          mastodonConnected: "1",
          imported: String(importedPosts),
          ...(existing ? { reconnected: "1" } : {}),
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to complete Mastodon authorization";
      return reply.redirect(connectionsPageUrl({ mastodonError: message }));
    }
    },
  );
}
