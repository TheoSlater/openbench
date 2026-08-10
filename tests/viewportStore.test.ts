import {
  AI_TERMINAL_TAB_ID,
  closeViewport,
  closeViewportTab,
  hideViewportDrawer,
  openAiTerminalTab,
  openViewportTerminal,
  selectViewportTab,
  setViewportTabOrder,
  showViewportDrawer,
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

  it("opens a terminal tab and shows the drawer", () => {
    const id = openViewportTerminal();

    const state = useViewportStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe(id);
    expect(state.drawerOpen).toBe(true);
  });

  it("gives each tab its own id and activates the newest", () => {
    const first = openViewportTerminal();
    const second = openViewportTerminal();

    expect(first).not.toBe(second);
    expect(useViewportStore.getState().tabs).toEqual([
      first,
      second,
    ]);
    expect(useViewportStore.getState().activeTabId).toBe(second);
  });

  it("closes one tab and selects its nearest neighbor", () => {
    const first = openViewportTerminal();
    const second = openViewportTerminal();
    const third = openViewportTerminal();

    selectViewportTab(second);
    closeViewportTab(second);

    const state = useViewportStore.getState();
    expect(state.tabs).toEqual([first, third]);
    expect(state.activeTabId).toBe(first);
  });

  it("closes the drawer once the last tab goes", () => {
    const only = openViewportTerminal();

    closeViewportTab(only);

    const state = useViewportStore.getState();
    expect(state.tabs).toHaveLength(0);
    expect(state.activeTabId).toBeNull();
    expect(state.drawerOpen).toBe(false);
  });

  it("reorders tabs and keeps the active tab", () => {
    const first = openViewportTerminal();
    const second = openViewportTerminal();
    selectViewportTab(first);

    setViewportTabOrder([second, first]);

    const state = useViewportStore.getState();
    expect(state.tabs).toEqual([second, first]);
    expect(state.activeTabId).toBe(first);
  });

  it("ignores a reorder that does not name exactly the current tabs", () => {
    const first = openViewportTerminal();
    const second = openViewportTerminal();

    setViewportTabOrder([first]);
    setViewportTabOrder([first, first]);

    expect(useViewportStore.getState().tabs).toEqual([
      first,
      second,
    ]);
  });

  it("hides the drawer without discarding tabs", () => {
    openViewportTerminal();

    hideViewportDrawer();

    const state = useViewportStore.getState();
    expect(state.drawerOpen).toBe(false);
    expect(state.tabs).toHaveLength(1);
  });

  it("reopens the existing terminal instead of spawning another", () => {
    const first = openViewportTerminal();
    hideViewportDrawer();

    showViewportDrawer();

    const state = useViewportStore.getState();
    expect(state.tabs).toEqual([first]);
    expect(state.drawerOpen).toBe(true);
  });

  it("spawns a terminal on first open only", () => {
    showViewportDrawer();

    expect(useViewportStore.getState().tabs).toHaveLength(1);

    showViewportDrawer();

    expect(useViewportStore.getState().tabs).toHaveLength(1);
  });

  it("clears every tab", () => {
    openViewportTerminal();
    openViewportTerminal();

    closeViewport();

    const state = useViewportStore.getState();
    expect(state.tabs).toHaveLength(0);
    expect(state.drawerOpen).toBe(false);
  });

  it("opens one AI transcript tab and reselects it on repeat calls", () => {
    openAiTerminalTab();
    openAiTerminalTab();

    const state = useViewportStore.getState();
    expect(state.tabs).toEqual([AI_TERMINAL_TAB_ID]);
    expect(state.activeTabId).toBe(AI_TERMINAL_TAB_ID);
    expect(state.drawerOpen).toBe(true);
  });

  it("keeps the AI transcript tab alongside real terminals", () => {
    const terminal = openViewportTerminal();

    openAiTerminalTab();

    const state = useViewportStore.getState();
    expect(state.tabs).toEqual([terminal, AI_TERMINAL_TAB_ID]);
    expect(state.activeTabId).toBe(AI_TERMINAL_TAB_ID);
  });

});
