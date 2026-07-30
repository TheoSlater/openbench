import { create } from "zustand";
import type { RuntimeRef } from "@/generated/bindings/RuntimeRef";
import { readDefaultRuntime } from "@/lib/runtime/legacy-default-model";

type RuntimeState = {
  selected: RuntimeRef | null;
  label: string;
  actions: {
    select: (runtime: RuntimeRef, label: string) => void;
    clear: () => void;
  };
};

export const useRuntimeStore = create<RuntimeState>((set) => ({
  selected: readDefaultRuntime(),
  label: "",
  actions: {
    select: (selected, label) => set({ selected, label }),
    clear: () => set({ selected: null, label: "" }),
  },
}));
