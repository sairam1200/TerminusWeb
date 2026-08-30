import { describe, expect, it } from "vitest";
import { validatePrivateWssPolicy } from "./endpointPolicy";
import { ProtocolViolation } from "./types";

describe("private WSS endpoint policy", () => {
  it("accepts only an exact HTTPS web origin and credential-free WSS destination", () => {
    expect(
      validatePrivateWssPolicy(
        {
          endpoint: "wss://agent.private.invalid/terminal",
          expectedWebOrigin: "https://preview.example.invalid",
        },
        "https://preview.example.invalid",
      ),
    ).toMatchObject({
      endpoint: "wss://agent.private.invalid/terminal",
      expectedWebOrigin: "https://preview.example.invalid",
      cspSource: "wss://agent.private.invalid",
      subprotocol: "terminus.v0_2",
    });
  });

  it.each([
    ["ws://agent.private.invalid/terminal", "https://preview.example.invalid"],
    [
      "wss://secret@agent.private.invalid/terminal",
      "https://preview.example.invalid",
    ],
    [
      "wss://agent.private.invalid/terminal?token=forbidden",
      "https://preview.example.invalid",
    ],
    ["wss://agent.private.invalid/terminal", "https://other.example.invalid"],
    ["wss://agent.private.invalid/terminal", "http://preview.example.invalid"],
  ])(
    "fails closed for destination %s or current origin %s",
    (endpoint, currentOrigin) => {
      expect(() =>
        validatePrivateWssPolicy(
          { endpoint, expectedWebOrigin: "https://preview.example.invalid" },
          currentOrigin,
        ),
      ).toThrow(ProtocolViolation);
    },
  );
});
