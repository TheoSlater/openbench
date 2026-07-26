// @vitest-environment jsdom

import { createRef } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const invoke = vi.fn(() => Promise.resolve(null));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...(args as [])),
  Channel: class {
    onmessage: ((message: unknown) => void) | null = null;
  },
}));

let resizeObserverCallback: (() => void) | null = null;

beforeEach(() => {
  vi.resetModules();
  invoke.mockClear();
  resizeObserverCallback = null;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resizeObserverCallback = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
});

/** A canvas jsdom will hand out a 2d context and a non-zero size for. */
function stubCanvas() {
  const canvas = document.createElement("canvas");
  canvas.getContext = (() => ({ putImageData: () => {} })) as never;
  canvas.getBoundingClientRect = (() => ({ width: 800, height: 600 })) as never;
  return canvas;
}

const invokedCommands = () => invoke.mock.calls.map((call) => call[0]);

it("opens one browser per mount, no matter how the caller re-renders", async () => {
  const { useCefSurface } = await import("../src/features/viewport/hooks/useCefSurface");

  const canvasRef = createRef<HTMLCanvasElement>();
  (canvasRef as { current: HTMLCanvasElement }).current = stubCanvas();

  // Fresh inline callbacks on every render, exactly as ViewportDrawer passes
  // them. Depending on their identity used to close and reopen the browser on
  // every keystroke in the address bar.
  const render = () =>
    useCefSurface({
      canvasRef,
      initialUrl: "https://example.com",
      onFirstFrame: () => {},
      onAddressChange: () => {},
      onNavState: () => {},
      onError: () => {},
      takeScrollLatencyMs: () => null,
    });

  const { rerender } = renderHook(render);

  await act(async () => {
    resizeObserverCallback?.();
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
  expect(invokedCommands()).toEqual(["cef_viewport_open"]);

  for (let i = 0; i < 5; i += 1) rerender();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
  });

  expect(invokedCommands()).toEqual(["cef_viewport_open"]);
  expect(invokedCommands()).not.toContain("cef_viewport_close");
});

it("closes the browser when the canvas unmounts", async () => {
  const { useCefSurface } = await import("../src/features/viewport/hooks/useCefSurface");

  const canvasRef = createRef<HTMLCanvasElement>();
  (canvasRef as { current: HTMLCanvasElement }).current = stubCanvas();

  const { unmount } = renderHook(() =>
    useCefSurface({
      canvasRef,
      initialUrl: "https://example.com",
      onFirstFrame: () => {},
      onAddressChange: () => {},
      onNavState: () => {},
      onError: () => {},
      takeScrollLatencyMs: () => null,
    }),
  );

  await act(async () => {
    resizeObserverCallback?.();
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
  unmount();

  expect(invokedCommands()).toEqual(["cef_viewport_open", "cef_viewport_close"]);
});
