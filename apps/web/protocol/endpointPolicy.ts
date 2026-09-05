import { PROTOCOL_SUBPROTOCOL } from "./constants";
import { ProtocolViolation } from "./types";

export type ConnectionMode = "local" | "private";

export interface PrivateWssPolicy {
  endpoint: string;
  expectedWebOrigin: string;
}

export interface ValidatedPrivateWssPolicy extends PrivateWssPolicy {
  cspSource: string;
  subprotocol: typeof PROTOCOL_SUBPROTOCOL;
}

export function validatePrivateWssPolicy(
  policy: PrivateWssPolicy,
  currentWebOrigin: string,
): ValidatedPrivateWssPolicy {
  let endpoint: URL;
  let expectedOrigin: URL;
  let actualOrigin: URL;
  try {
    endpoint = new URL(policy.endpoint);
    expectedOrigin = new URL(policy.expectedWebOrigin);
    actualOrigin = new URL(currentWebOrigin);
  } catch {
    throw new ProtocolViolation("ORIGIN_REJECTED", 1008);
  }

  if (
    endpoint.protocol !== "wss:" ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.search !== "" ||
    endpoint.hash !== "" ||
    expectedOrigin.protocol !== "https:" ||
    expectedOrigin.pathname !== "/" ||
    expectedOrigin.search !== "" ||
    expectedOrigin.hash !== "" ||
    expectedOrigin.username !== "" ||
    expectedOrigin.password !== "" ||
    actualOrigin.origin !== expectedOrigin.origin ||
    policy.expectedWebOrigin !== expectedOrigin.origin
  ) {
    throw new ProtocolViolation("ORIGIN_REJECTED", 1008);
  }

  return {
    endpoint: endpoint.href,
    expectedWebOrigin: expectedOrigin.origin,
    cspSource: endpoint.origin,
    subprotocol: PROTOCOL_SUBPROTOCOL,
  };
}

export function validateWssPolicy(
  policy: PrivateWssPolicy & { mode?: ConnectionMode },
  currentWebOrigin: string,
): ValidatedPrivateWssPolicy {
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
