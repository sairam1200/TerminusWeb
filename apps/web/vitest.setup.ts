import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

class ResizeObserverTestDouble implements ResizeObserver {
  readonly observed = new Set<Element>();

  disconnect(): void {
    this.observed.clear();
  }

  observe(target: Element): void {
    this.observed.add(target);
  }

  unobserve(target: Element): void {
    this.observed.delete(target);
  }
}

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: ResizeObserverTestDouble,
});

Object.defineProperty(globalThis, "requestAnimationFrame", {
  configurable: true,
  value: (callback: FrameRequestCallback) => window.setTimeout(callback, 0),
});

Object.defineProperty(globalThis, "cancelAnimationFrame", {
  configurable: true,
  value: (handle: number) => window.clearTimeout(handle),
});
