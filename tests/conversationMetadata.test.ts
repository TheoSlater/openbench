import { describe, expect, it } from "vitest";
import { InMemoryConversationRepository } from "../src/lib/repositories";
import { mapRowToConversation } from "../src/lib/repositories/types";

describe("conversation metadata", () => {
  it("maps persisted metadata JSON onto conversations", () => {
    const conversation = mapRowToConversation({
      id: "chat-1",
      title: "Search chat",
      createdAt: "2026-07-04T00:00:00.000Z",
      updatedAt: "2026-07-04T00:00:00.000Z",
      isArchived: 0,
      metadata: JSON.stringify({
        activeFeatureIds: ["web_search"],
      }),
    });

    expect(conversation.metadata?.activeFeatureIds).toEqual(["web_search"]);
  });

  it("updates in-memory conversation metadata", async () => {
    const repo = new InMemoryConversationRepository();
    await repo.createConversation("chat-1", "Search chat");
    await repo.updateConversation("chat-1", {
      metadata: {
        activeFeatureIds: ["web_search"],
        surfaces: [{ kind: "browser", id: "browser-1", url: "http://localhost:5173" }],
      },
    });

    const [conversation] = await repo.getConversations();

    expect(conversation.metadata?.activeFeatureIds).toEqual(["web_search"]);
    expect(conversation.metadata?.surfaces?.[0]).toMatchObject({
      kind: "browser",
      id: "browser-1",
    });
  });
});
