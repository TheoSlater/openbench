import {
  closeViewportForChat,
  closeViewportTab,
  openEmptyViewport,
  openViewportForUser,
  openViewportPreviewUrl,
  openViewportTerminal,
  setViewportTabOrder,
  updateViewportBrowserUrl,
  useViewportStore,
} from "../src/features/viewport/viewportStore";

const resetViewportStore = () => {
  useViewportStore.setState({
    tabs: [],
    activeTabId: null,
    drawerOpen: false,
    drawerWidth: 440,
  });
};

describe("viewport drawer state", () => {
  beforeEach(resetViewportStore);

  it("opens multiple browser and terminal tabs", () => {
    openEmptyViewport();
    openEmptyViewport();
    openViewportTerminal();
    openViewportTerminal();

    expect(useViewportStore.getState().tabs.map((tab) => tab.type)).toEqual([
      "browser",
      "browser",
      "terminal",
      "terminal",
    ]);
    expect(useViewportStore.getState().activeTabId).toBe(
      useViewportStore.getState().tabs[3].id,
    );
  });

  it("opens user links in independent browser tabs", async () => {
    await openViewportForUser("https://example.com");
    await openViewportForUser("https://openai.com");

    const sessions = useViewportStore
      .getState()
      .tabs.map((tab) => tab.session?.url);
    expect(sessions).toEqual(["https://example.com/", "https://openai.com/"]);
  });

  it("navigates an empty browser without creating another tab", () => {
    const id = openEmptyViewport();
    updateViewportBrowserUrl(id, "https://example.com");

    expect(useViewportStore.getState().tabs).toHaveLength(1);
    expect(useViewportStore.getState().tabs[0].session?.url).toBe(
      "https://example.com/",
    );
  });

  it("ignores non-http preview urls", async () => {
    await openViewportForUser("javascript:alert(1)");
    expect(useViewportStore.getState().tabs).toEqual([]);
  });

  it("closes one tab and selects its nearest neighbor", () => {
    const first = openEmptyViewport();
    const second = openViewportTerminal();
    const third = openEmptyViewport();

    closeViewportTab(third);
    expect(useViewportStore.getState().activeTabId).toBe(second);

    closeViewportTab(second);
    expect(useViewportStore.getState().activeTabId).toBe(first);

    closeViewportTab(first);
    expect(useViewportStore.getState()).toMatchObject({
      tabs: [],
      activeTabId: null,
      drawerOpen: false,
    });
  });

  it("reorders tabs and keeps the active tab", () => {
    const first = openEmptyViewport();
    const second = openViewportTerminal();
    const third = openEmptyViewport();

    setViewportTabOrder([third, first, second]);

    expect(useViewportStore.getState().tabs.map((tab) => tab.id)).toEqual([
      third,
      first,
      second,
    ]);
    expect(useViewportStore.getState().activeTabId).toBe(third);

    setViewportTabOrder([first, second, third]);
    expect(useViewportStore.getState().tabs.map((tab) => tab.id)).toEqual([
      first,
      second,
      third,
    ]);
  });

  it("closes only browser tabs belonging to a chat", () => {
    openViewportPreviewUrl({
      chatId: "chat-1",
      url: "https://example.com",
      openedBy: "chat",
    });
    openViewportPreviewUrl({
      chatId: "chat-2",
      url: "https://openai.com",
      openedBy: "chat",
    });
    openViewportTerminal();

    closeViewportForChat("chat-1");

    expect(useViewportStore.getState().tabs).toHaveLength(2);
    expect(
      useViewportStore.getState().tabs.some((tab) => tab.session?.chatId === "chat-1"),
    ).toBe(false);
  });
});
