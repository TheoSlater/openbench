import { create } from "zustand";
import { loggedInvoke } from "@/lib/utils";

/**
 * # Tool Store
 * 
 * Manages the state of available tools and handles the tool approval workflow.
 * This store communicates with the Rust backend via Tauri commands to list,
 * toggle, and approve/deny tool invocations.
 */

export type ToolSource = "builtin";

/**
 * Definition of a tool as returned by the backend.
 */
export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  source: ToolSource;
  requiresApproval: boolean;
  enabled: boolean;
};

export type PendingToolCall = {
  invocationId: string;
  requestId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
};

type ToolStore = {
  tools: ToolDefinition[];
  pendingApproval: PendingToolCall | null;
  isLoading: boolean;
  actions: {
    loadTools: () => Promise<void>;
    toggleTool: (name: string) => Promise<void>;
    approveToolCall: (invocationId: string, alwaysAllow?: boolean) => void;
    denyToolCall: (invocationId: string) => void;
    setPendingApproval: (pending: PendingToolCall | null) => void;
  };
};

export const useToolStore = create<ToolStore>((set) => ({
  tools: [],
  pendingApproval: null,
  isLoading: false,
  actions: {
    loadTools: async () => {
      set({ isLoading: true });
      try {
        const tools = await loggedInvoke<ToolDefinition[]>("list_tools");
        set({ tools, isLoading: false });
      } catch (err) {
        console.error("Failed to load tools:", err);
        set({ isLoading: false });
      }
    },

    toggleTool: async (name: string) => {
      try {
        const newState = await loggedInvoke<boolean | null>("toggle_tool", {
          name,
        });
        if (newState !== null) {
          set((state) => ({
            tools: state.tools.map((t) =>
              t.name === name ? { ...t, enabled: !!newState } : t,
            ),
          }));
        }
      } catch (err) {
        console.error("Failed to toggle tool:", err);
      }
    },

    approveToolCall: (invocationId: string, alwaysAllow = false) => {
      loggedInvoke("approve_tool", {
        response: {
          invocationId,
          approved: true,
          alwaysAllow,
        },
      }).catch(console.error);
      set({ pendingApproval: null });
    },

    denyToolCall: (invocationId: string) => {
      loggedInvoke("approve_tool", {
        response: {
          invocationId,
          approved: false,
          alwaysAllow: false,
        },
      }).catch(console.error);
      set({ pendingApproval: null });
    },

    setPendingApproval: (pending) => set({ pendingApproval: pending }),
  },
}));
