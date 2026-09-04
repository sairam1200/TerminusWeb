import { describe, expect, it } from "vitest";
import { validateLocalWssPolicy, validatePrivateWssPolicy, validateWssPolicy } from "./endpointPolicy";
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
      subprotocol: "terminus.v0_1",
    });
  });

  it("accepts localhost and 127.0.0.1 local mode with loopback origins", () => {
    expect(
      validateLocalWssPolicy(
        {
          mode: "local",
          endpoint: "wss://127.0.0.1:4176/terminal",
          expectedWebOrigin: "http://127.0.0.1:4176",
        },
        "http://127.0.0.1:4176",
      ),
    ).toMatchObject({
      endpoint: "wss://127.0.0.1:4176/terminal",
      expectedWebOrigin: "http://127.0.0.1:4176",
      cspSource: "wss://127.0.0.1:4176",
      subprotocol: "terminus.v0_1",
    });
  });

  it("accepts wss policy mode dispatch from generic validator", () => {
    const local = validateWssPolicy(
      {
        mode: "local",
        endpoint: "wss://127.0.0.1:4176/terminal",
        expectedWebOrigin: "http://127.0.0.1:4176",
      },
      "http://127.0.0.1:4176",
    );
    expect(local.mode).toBe("local");
    const priv = validateWssPolicy(
      {
        mode: "private",
        endpoint: "wss://agent.private.invalid/terminal",
        expectedWebOrigin: "https://preview.example.invalid",
      },
      "https://preview.example.invalid",
    );
    expect(priv.mode).toBe("private");
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
    ["wss://agent.local:5173/terminal", "https://preview.example.invalid"],
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

  it("rejects non-loopback local policy endpoints or origins", () => {
    expect(() =>
      validateLocalWssPolicy(
        {
          mode: "local",
          endpoint: "wss://agent.local.invalid/terminal",
          expectedWebOrigin: "https://preview.example.invalid",
        },
        "https://preview.example.invalid",
      ),
    ).toThrow(ProtocolViolation);
    expect(() =>
      validateLocalWssPolicy(
        {
          mode: "local",
          endpoint: "wss://127.0.0.1:4176/terminal",
          expectedWebOrigin: "https://127.0.0.1:4176",
        },
        "http://127.0.0.1:4176",
      ),
    ).toThrow(ProtocolViolation);
  });
});
