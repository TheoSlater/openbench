import { create } from "zustand";
import type { RuntimeRef } from "@/generated/bindings/RuntimeRef";
import { runtimeLabel } from "@/features/runtime/runtime-options";
import { readDefaultRuntime } from "@/lib/runtime/legacy-default-model";

type RuntimeState = {
  selected: RuntimeRef | null;
  label: string;
  accessMode: "read-only" | "workspace-write";
  actions: {
    select: (runtime: RuntimeRef, label: string) => void;
    clear: () => void;
    setAccessMode: (mode: RuntimeState["accessMode"]) => void;
  };
};

const defaultRuntime = readDefaultRuntime();

export const useRuntimeStore = create<RuntimeState>((set) => ({
  selected: defaultRuntime,
  label: runtimeLabel(defaultRuntime),
  accessMode: "read-only",
  actions: {
    select: (selected, label) => set({ selected, label }),
    clear: () => set({ selected: null, label: "" }),
    setAccessMode: (accessMode) => set({ accessMode }),
  },
}));
