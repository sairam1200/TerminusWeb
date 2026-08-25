import { describe, expect, it, vi } from "vitest";
import {
  MockDestinationError,
  MockTerminalAdapter,
} from "./mockTerminalAdapter";

describe("MockTerminalAdapter", () => {
  it("connects locally and emits only a simulated marker", async () => {
    const adapter = new MockTerminalAdapter();
    const output = vi.fn();
    adapter.subscribeOutput(output);

    await adapter.connect();

    expect(adapter.kind).toBe("test-double");
    expect(adapter.getState()).toBe("connected");
    expect(output).toHaveBeenCalledWith("[SIMULATED SESSION READY]");
  });

  it("rejects every destination instead of opening a network path", async () => {
    const adapter = new MockTerminalAdapter();

    await expect(
      adapter.connect({ destination: "wss://private.invalid" }),
    ).rejects.toBeInstanceOf(MockDestinationError);
    expect(adapter.getState()).toBe("error");
  });

  it("rejects input while disconnected", () => {
    const adapter = new MockTerminalAdapter();
    expect(() => adapter.sendInput("synthetic-input")).toThrow(
      /not connected/i,
    );
  });

  it("accepts minimum viewport dimensions and rejects invalid boundaries", () => {
    const adapter = new MockTerminalAdapter();

    expect(() => adapter.resize({ columns: 1, rows: 1 })).not.toThrow();
    expect(() => adapter.resize({ columns: 0, rows: 1 })).toThrow(RangeError);
    expect(() => adapter.resize({ columns: 1.5, rows: 1 })).toThrow(RangeError);
  });
});
