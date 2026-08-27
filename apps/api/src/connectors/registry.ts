import type { PlatformId } from "../config.js";
import { wrapConnector } from "../lib/resilience.js";
import { getConnector as getDemoConnector } from "./demo.js";
import type { PlatformConnector } from "./types.js";

/**
 * The connector registry is the single place that decides, per platform,
 * whether to use a real (live) connector implementation or fall back to the
 * deterministic demo connector. Live connectors register themselves here
 * (see registerLiveConnector) as they're implemented platform by platform
 * (build charter Phase C) — nothing else in the codebase should import a
 * live connector module directly.
 *
 * A platform stays on the demo connector whenever:
 *   - no live implementation has been registered for it yet, or
 *   - the specific connection has no stored credentials (hasCredentials=false),
 *     so the app never goes dark waiting on a real API.
 */
type ConnectorFactory = () => PlatformConnector;

const liveFactories = new Map<PlatformId, ConnectorFactory>();

/** Called by a live connector module to register itself for its platform. */
export function registerLiveConnector(platform: PlatformId, factory: ConnectorFactory): void {
  liveFactories.set(platform, factory);
}

/** True once a live connector implementation exists for this platform, regardless of credentials. */
export function hasLiveConnector(platform: PlatformId): boolean {
  return liveFactories.has(platform);
}

/**
 * Resolves the connector to use for a given platform + connection.
 * @param hasCredentials Whether the connection has a decrypted, usable
 *   credential (access token or app password) available to hand it. Callers
 *   determine this from the Connection row before decrypting anything.
 */
export function getConnector(platform: PlatformId, hasCredentials = false): PlatformConnector {
  if (hasCredentials) {
    const factory = liveFactories.get(platform);
    // Live connectors get the Phase C5 resilience wrapper (retries with
    // backoff, 429 handling, per-connection circuit breaker, credential
    // refresh). Demo connectors are local and deterministic — wrapping
    // them would add nothing but nondeterminism to tests.
    if (factory) return wrapConnector(factory());
  }
  return getDemoConnector(platform);
}

/** Test-only: clears registered live connectors between test cases. */
export function __resetRegistryForTests(): void {
  liveFactories.clear();
}
