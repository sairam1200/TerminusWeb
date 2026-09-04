import { PROTOCOL_SUBPROTOCOL } from "./constants";
import { ProtocolViolation } from "./types";

export type ConnectionMode = "local" | "private";

export interface PrivateWssPolicy {
  mode?: ConnectionMode;
  endpoint: string;
  expectedWebOrigin: string;
}

export interface ValidatedPrivateWssPolicy extends PrivateWssPolicy {
  mode: ConnectionMode;
  cspSource: string;
  subprotocol: typeof PROTOCOL_SUBPROTOCOL;
}

export type ValidatedWssPolicy = ValidatedPrivateWssPolicy;

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function isPrivateDisallowedHostname(hostname: string): boolean {
  return isLoopbackHostname(hostname) || hostname.endsWith(".local");
}

function parseCommonUrls(policy: PrivateWssPolicy): {
  endpoint: URL;
  expectedOrigin: URL;
} {
  let endpoint: URL;
  let expectedOrigin: URL;
  try {
    endpoint = new URL(policy.endpoint);
    expectedOrigin = new URL(policy.expectedWebOrigin);
  } catch {
    throw new ProtocolViolation("ORIGIN_REJECTED", 1008);
  }

  if (
    endpoint.protocol !== "wss:" ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.search !== "" ||
    endpoint.hash !== "" ||
    expectedOrigin.pathname !== "/" ||
    expectedOrigin.search !== "" ||
    expectedOrigin.hash !== "" ||
    expectedOrigin.username !== "" ||
    expectedOrigin.password !== ""
  ) {
    throw new ProtocolViolation("ORIGIN_REJECTED", 1008);
  }

  return { endpoint, expectedOrigin };
}

export function validatePrivateWssPolicy(
  policy: PrivateWssPolicy,
  currentWebOrigin: string,
): ValidatedPrivateWssPolicy {
  const { endpoint, expectedOrigin } = parseCommonUrls(policy);
  let actualOrigin: URL;
  try {
    actualOrigin = new URL(currentWebOrigin);
  } catch {
    throw new ProtocolViolation("ORIGIN_REJECTED", 1008);
  }

  if (
    expectedOrigin.origin !== actualOrigin.origin ||
    endpoint.hostname === "" ||
    expectedOrigin.hostname === "" ||
    isPrivateDisallowedHostname(endpoint.hostname)
  ) {
    throw new ProtocolViolation("ORIGIN_REJECTED", 1008);
  }

  return {
    mode: "private",
    endpoint: endpoint.href,
    expectedWebOrigin: expectedOrigin.origin,
    cspSource: endpoint.origin,
    subprotocol: PROTOCOL_SUBPROTOCOL,
  };
}

export function validateLocalWssPolicy(
  policy: PrivateWssPolicy,
  currentWebOrigin: string,
): ValidatedPrivateWssPolicy {
  const { endpoint, expectedOrigin } = parseCommonUrls(policy);
  let actualOrigin: URL;
  try {
    actualOrigin = new URL(currentWebOrigin);
  } catch {
    throw new ProtocolViolation("ORIGIN_REJECTED", 1008);
  }

  if (
    expectedOrigin.protocol !== "http:" &&
    expectedOrigin.protocol !== "https:"
  ) {
    throw new ProtocolViolation("ORIGIN_REJECTED", 1008);
  }

  if (
    policy.expectedWebOrigin !== expectedOrigin.origin ||
    actualOrigin.origin !== expectedOrigin.origin ||
    !isLoopbackHostname(endpoint.hostname) ||
    !isLoopbackHostname(expectedOrigin.hostname) ||
    !isLoopbackHostname(actualOrigin.hostname)
  ) {
    throw new ProtocolViolation("ORIGIN_REJECTED", 1008);
  }

  return {
    mode: "local",
    endpoint: endpoint.href,
    expectedWebOrigin: expectedOrigin.origin,
    cspSource: endpoint.origin,
    subprotocol: PROTOCOL_SUBPROTOCOL,
  };
}

export function validateWssPolicy(
  policy: PrivateWssPolicy,
  currentWebOrigin: string,
): ValidatedPrivateWssPolicy {
  if ((policy.mode ?? "private") === "local") {
    return validateLocalWssPolicy(policy, currentWebOrigin);
  }
  return validatePrivateWssPolicy(policy, currentWebOrigin);
}

export function privateWssCspSource(
  endpointValue?: string,
): string | undefined {
  if (endpointValue === undefined || endpointValue === "") return undefined;
  let endpoint: URL;
  try {
    endpoint = new URL(endpointValue);
  } catch {
    throw new Error(
      "NEXT_PUBLIC_TERMINUS_WSS_ENDPOINT must be an absolute URL.",
    );
  }
  if (
    endpoint.protocol !== "wss:" ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.search !== "" ||
    endpoint.hash !== ""
  ) {
    throw new Error(
      "NEXT_PUBLIC_TERMINUS_WSS_ENDPOINT must be a credential-free wss:// URL.",
    );
  }
  return endpoint.origin;
}
