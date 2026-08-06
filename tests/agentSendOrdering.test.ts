import { describe, expect, it } from "vitest";
import { setRepository } from "@/lib/repositories";
import { InMemoryConversationRepository } from "@/lib/repositories";
import { useChatStore } from "@/store/chatStore";

const row = (m: { role: string; status?: string; content: string }) =>
  `${m.role}${m.status ?? ""}`.padEnd(14, " ") + m.content.slice(0, 18);

describe("agent send ordering", () => {
  it("keeps the new user message below the previous assistant response", async () => {
    setRepository(new InMemoryConversationRepository());
    const store = useChatStore.getState();
    await store.actions.loadConversations();

    const c1 = await store.actions.createConversation("Cool", false);
    await store.actions.addMessage({
      id: "u1", conversationId: c1.id, role: "user", content: "first q",
      createdAt: "2026-08-06T10:00:00.000Z",
    });
    await store.actions.addMessage({
      id: "a1", conversationId: c1.id, role: "assistant", content: "first answer",
      createdAt: "2026-08-06T10:00:05.000Z",
    });
    expect(useChatStore.getState().messages.map(row)).toEqual([
      "user          first q",
      "assistant     first answer",
    ]);

    // sendMessage for an agent
    await store.actions.addMessage({
      id: "u2", conversationId: c1.id, role: "user", content: "second q",
      createdAt: new Date().toISOString(),
    });
    expect(useChatStore.getState().messages.map(row)).toEqual([
      "user          first q",
      "assistant     first answer",
      "user          second q",
    ]);

    // agent streams its reply; patch arrives with a (potentially stale)
    // createdAt from the AI SDK message
    store.actions.setStreamingMessage("a2", {
      id: "a2", conversationId: c1.id, role: "assistant", content: "second answer",
      createdAt: "2026-08-06T10:00:06.000Z", isStreaming: true,
    });
    store.actions.setStreamingConversationId(c1.id);

    // conversation switch reloads from the repo, which orders by createdAt
    await store.actions.setActiveConversationId(null);
    await store.actions.setActiveConversationId(c1.id);
    const afterReload = useChatStore.getState().messages.map(row);
    console.log("after reload:", afterReload);
    expect(afterReload[2]).toBe("user          second q");

    // finish commit
    await store.actions.addMessage({
      id: "a2", conversationId: c1.id, role: "assistant", content: "second answer",
      createdAt: "2026-08-06T10:00:06.000Z",
    });
    expect(useChatStore.getState().messages.map(row)).toEqual([
      "user          first q",
      "assistant     first answer",
      "user          second q",
      "assistant     second answer",
    ]);
  });
});
