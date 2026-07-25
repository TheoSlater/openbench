import { create } from "zustand";

type ConfirmRequest = {
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
};

type ConfirmStore = {
  pending: ConfirmRequest | null;
  actions: {
    request: (opts: ConfirmRequest) => void;
    dismiss: () => void;
  };
};

export const useConfirmStore = create<ConfirmStore>((set) => ({
  pending: null,
  actions: {
    request: (opts) => set({ pending: opts }),
    dismiss: () => set({ pending: null }),
  },
}));
