import { execFileSync } from "node:child_process";
import { webcrypto } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computeAuthenticationProof, importCredentialKey } from "./auth";
import { encodeBase64Url } from "./codec";
import { PROTOCOL_SOURCE_COMMIT } from "./constants";
import { evaluateHandshake, ProtocolContractMachine } from "./contractMachine";
import type {
  ProtocolDirection,
  ProtocolFrame,
  ProtocolMachineInitialState,
  ProtocolValidationContext,
} from "./types";
import { ProtocolViolation } from "./types";

interface FixtureFrame {
  direction: ProtocolDirection;
  frame?: ProtocolFrame;
  raw?: string;
  generate?: {
    field?: string;
    decodedBytes?: number;
    wireTrailingSpaces?: number;
  };
}

interface TranscriptFixture {
  id: string;
  initial: ProtocolMachineInitialState;
  context?: ProtocolValidationContext;
  frames: FixtureFrame[];
  expected: {
    connectionState?: string;
    sessionState?: string;
    nextOutputOffset?: number;
    code?: string;
    closeCode?: number;
    atFrame?: number;
  };
}

interface HandshakeFixture {
  id: string;
  request: { scheme: string; origin?: string; subprotocol: string };
  allowedOrigins: string[];
  expect?: "accept";
  expected?: { code: string; httpStatus: number };
}

interface FixtureDocument {
  contractVersion: string;
  handshakes: HandshakeFixture[];
  transcripts: TranscriptFixture[];
}

interface AuthVectors {
  contractVersion: string;
  vectors: Array<{
    credentialSecret: string;
    connectionId: string;
    challengeId: string;
    challenge: string;
    proof: string;
  }>;
  negativeMutations: Array<{
    field: "connectionId" | "challengeId" | "challenge" | "proof";
    value: string;
  }>;
}

const repositoryRoot = resolve(process.cwd(), "../..");
const accepted = readContractJson<FixtureDocument>(
  "packages/protocol/fixtures/accepted-0.2.json",
);
const rejected = readContractJson<FixtureDocument>(
  "packages/protocol/fixtures/rejected-0.2.json",
);
const authVectors = readContractJson<AuthVectors>(
  "packages/security/auth-vectors-0.2.json",
);

describe(`canonical protocol 0.2 fixtures at ${PROTOCOL_SOURCE_COMMIT}`, () => {
  it("runs every accepted and rejected handshake fixture", () => {
    for (const fixture of accepted.handshakes) {
      expect(
        evaluateHandshake(fixture.request, fixture.allowedOrigins),
        fixture.id,
      ).toEqual({
        code: "ACCEPT",
        httpStatus: 101,
      });
    }
    for (const fixture of rejected.handshakes) {
      expect(
        evaluateHandshake(fixture.request, fixture.allowedOrigins),
        fixture.id,
      ).toEqual(fixture.expected);
    }
  });

  it("accepts every canonical positive transcript", async () => {
    for (const fixture of accepted.transcripts) {
      const machine = new ProtocolContractMachine(fixture.initial);
      for (const spec of fixture.frames) {
        await machine.apply(spec.direction, materialize(spec), fixture.context);
      }
      const snapshot = machine.getSnapshot();
      expect(snapshot.connectionState, fixture.id).toBe(
        fixture.expected.connectionState,
      );
      expect(snapshot.sessionState, fixture.id).toBe(
        fixture.expected.sessionState,
      );
      if (fixture.expected.nextOutputOffset !== undefined) {
        expect(snapshot.nextOutputOffset, fixture.id).toBe(
          fixture.expected.nextOutputOffset,
        );
      }
    }
  });

  it("fails closed with the canonical first failure for every rejected transcript", async () => {
    for (const fixture of rejected.transcripts) {
      const machine = new ProtocolContractMachine(fixture.initial);
      let rejection:
        { code: string; closeCode: number; atFrame: number } | undefined;
      for (const [index, spec] of fixture.frames.entries()) {
        try {
          await machine.apply(
            spec.direction,
            materialize(spec),
            fixture.context,
          );
        } catch (error) {
          expect(error, fixture.id).toBeInstanceOf(ProtocolViolation);
          const violation = error as ProtocolViolation;
          rejection = {
            code: violation.code,
            closeCode: violation.closeCode,
            atFrame: index,
          };
          break;
        }
      }
      expect(rejection, fixture.id).toMatchObject({
        code: fixture.expected.code,
        atFrame: fixture.expected.atFrame,
        ...(fixture.expected.closeCode === undefined
          ? {}
          : { closeCode: fixture.expected.closeCode }),
      });
    }
  });

  it("passes the canonical positive HMAC vector and rejects every mutation", async () => {
    const cryptoProvider = webcrypto as unknown as Crypto;
    for (const vector of authVectors.vectors) {
      const key = await importCredentialKey(
        vector.credentialSecret,
        cryptoProvider,
      );
      expect(
        await computeAuthenticationProof(
          key,
          vector.connectionId,
          vector.challengeId,
          vector.challenge,
          cryptoProvider,
        ),
      ).toBe(vector.proof);

      for (const mutation of authVectors.negativeMutations) {
        const connectionId =
          mutation.field === "connectionId"
            ? mutation.value
            : vector.connectionId;
        const challengeId =
          mutation.field === "challengeId"
            ? mutation.value
            : vector.challengeId;
        const challenge =
          mutation.field === "challenge" ? mutation.value : vector.challenge;
        const candidate =
          mutation.field === "proof"
            ? mutation.value
            : await computeAuthenticationProof(
                key,
                connectionId,
                challengeId,
                challenge,
                cryptoProvider,
              );
        expect(
          connectionId === vector.connectionId &&
            challengeId === vector.challengeId &&
            challenge === vector.challenge &&
            candidate === vector.proof,
          `${mutation.field} mutation`,
        ).toBe(false);
      }
    }
  });
});

function readContractJson<T>(path: string): T {
  return JSON.parse(
    execFileSync("git", ["show", `${PROTOCOL_SOURCE_COMMIT}:${path}`], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }),
  ) as T;
}

function materialize(spec: FixtureFrame): string | ProtocolFrame {
  if (spec.raw !== undefined) return spec.raw;
  const frame = structuredClone(spec.frame) as ProtocolFrame;
  if (spec.generate?.field === "payload.data") {
    if (spec.generate.decodedBytes === undefined) {
      throw new Error("decodedBytes is required for payload.data generation");
    }
    frame.payload.data = encodeBase64Url(
      new Uint8Array(spec.generate.decodedBytes),
    );
  }
  const wire =
    JSON.stringify(frame) + " ".repeat(spec.generate?.wireTrailingSpaces ?? 0);
  return spec.generate?.wireTrailingSpaces === undefined ? frame : wire;
}
