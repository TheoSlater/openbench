import { create } from "zustand";
import type { AcpEvent } from "@/generated/bindings/AcpEvent";
import type { AcpLaunchRequest } from "@/generated/bindings/AcpLaunchRequest";
import type { PermissionDecision } from "@/generated/bindings/PermissionDecision";
import { useChatStore } from "@/store/chatStore";
import { acpClient } from "./client";
import { initialAcpActivity, reduceAcpActivity, type AcpActivityState } from "./activity-reducer";

type AcpActivityStore = {
  activities: Record<string, AcpActivityState>;
  histories: Record<string, AcpActivityState[]>;
  sessionToConversation: Record<string, string>;
  listening: boolean;
  actions: {
    listen: () => Promise<void>;
    start: (request: AcpLaunchRequest) => Promise<void>;
    prompt: (conversationId: string, prompt: string) => Promise<void>;
    cancel: (conversationId: string) => Promise<void>;
    stop: (conversationId: string) => Promise<void>;
    answer: (conversationId: string, requestId: string, decision: PermissionDecision) => Promise<void>;
  };
};

function applyEvent(event: AcpEvent) {
  const completed = { conversationId: "", answer: "" };

  useAcpActivityStore.setState((state) => {
    const conversationId =
      state.sessionToConversation[event.session_id] ?? event.session_id;
    const current =
      state.activities[conversationId] ?? initialAcpActivity(conversationId);
    const next = reduceAcpActivity(current, event);

    // A successfully completed turn becomes a normal persisted assistant
    // message right away, instead of sitting in ephemeral activity state
    // until the next prompt archives it. Un-archived, every turn rendered
    // as one lump after the whole message list rather than where it
    // belongs in the conversation — cancelled/failed turns still fall
    // back to the history archive below.
    if (next.status === "completed" && next.answer.trim()) {
      completed.conversationId = conversationId;
      completed.answer = next.answer;
      return {
        activities: {
          ...state.activities,
          [conversationId]: initialAcpActivity(conversationId),
        },
      };
    }

    return {
      activities: {
        ...state.activities,
        [conversationId]: next,
      },
    };
  });

  if (completed.conversationId) {
    void useChatStore.getState().actions.addMessage({
      conversationId: completed.conversationId,
      role: "assistant",
      content: completed.answer,
    });
  }
}

export const useAcpActivityStore = create<AcpActivityStore>((set, get) => ({
  activities: {},
  histories: {},
  sessionToConversation: {},
  listening: false,
  actions: {
    listen: async () => {
      if (get().listening) return;
      set({ listening: true });
      try {
        await acpClient.events(applyEvent);
      } catch (error) {
        set({ listening: false });
        throw error;
      }
    },
    start: async (request) => {
      await get().actions.listen();
      set((state) => ({
        activities: {
          ...state.activities,
          [request.conversation_id]: {
            ...initialAcpActivity(request.conversation_id),
            status: "running",
          },
        },
      }));
      const started = await acpClient.start(request);
      set((state) => ({
        sessionToConversation: {
          ...state.sessionToConversation,
          [started.session_id]: request.conversation_id,
        },
        activities: {
          ...state.activities,
          [request.conversation_id]: {
            ...(state.activities[request.conversation_id] ??
              initialAcpActivity(request.conversation_id)),
            sessionId: started.session_id,
            descriptor: started.descriptor,
            status: "running",
          },
        },
      }));
    },
    prompt: async (conversationId, prompt) => {
      set((state) => {
        const current = state.activities[conversationId];
        const archive = current && current.status !== "idle" && current.answer
          ? [...(state.histories[conversationId] ?? []), current]
          : state.histories[conversationId] ?? [];
        return {
          histories: { ...state.histories, [conversationId]: archive },
          activities: {
            ...state.activities,
            [conversationId]: {
              ...initialAcpActivity(conversationId),
              sessionId: current?.sessionId ?? null,
              descriptor: current?.descriptor ?? null,
              status: "running",
            },
          },
        };
      });
      await acpClient.prompt(conversationId, prompt);
    },
    cancel: async (conversationId) => {
      await acpClient.cancel(conversationId);
      set((state) => ({
        activities: {
          ...state.activities,
          [conversationId]: {
            ...(state.activities[conversationId] ?? initialAcpActivity(conversationId)),
            permission: null,
            thinking: false,
            status: "cancelled",
          },
        },
      }));
    },
    stop: async (conversationId) => {
      await acpClient.stop(conversationId);
      set((state) => ({
        activities: {
          ...state.activities,
          [conversationId]: {
            ...(state.activities[conversationId] ?? initialAcpActivity(conversationId)),
            permission: null,
            thinking: false,
            status: "cancelled",
          },
        },
      }));
    },
    answer: async (conversationId, requestId, decision) => {
      await acpClient.answer(conversationId, requestId, decision);
      set((state) => ({
        activities: {
          ...state.activities,
          [conversationId]: {
            ...(state.activities[conversationId] ?? initialAcpActivity(conversationId)),
            permission: null,
          },
        },
      }));
    },
  },
}));
