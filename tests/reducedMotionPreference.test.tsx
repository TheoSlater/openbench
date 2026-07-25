// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
}));

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  window.matchMedia = vi.fn(() => ({ matches: true })) as unknown as typeof window.matchMedia;
});

it("uses the OS preference as the initial setting but lets the user disable it", async () => {
  const { defaultPerformance, useSettingsStore } = await import("../src/store/settingsStore");
  const { useReducedMotion } = await import("../src/hooks/useReducedMotion");

  expect(defaultPerformance.reduceMotion).toBe(true);

  act(() => {
    useSettingsStore.getState().actions.updatePerformance({ reduceMotion: false });
  });

  const { result } = renderHook(() => useReducedMotion());
  expect(result.current).toBe(false);
});

it("does not let the OS preference silently reduce the performance policy", async () => {
  const { getPerformanceProfile } = await import("../src/lib/performance/policy");
  expect(getPerformanceProfile({ hardwareConcurrency: 8, deviceMemory: 8 }).reducedMotion).toBe(false);
});

it("moves existing OS-reduced users to the visible setting once", async () => {
  localStorage.setItem(
    "polyui:settings",
    JSON.stringify({
      version: 24,
      state: {
        performance: {
          reduceMotion: false,
          reduceTransparency: false,
          appZoom: 1,
          keepViewportActive: false,
        },
      },
    }),
  );

  const { useSettingsStore } = await import("../src/store/settingsStore");
  expect(useSettingsStore.getState().performance.reduceMotion).toBe(true);
});
