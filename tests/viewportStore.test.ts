import {
  closeViewport,
  closeViewportTab,
  hideViewportDrawer,
  openViewportTerminal,
  selectViewportTab,
  setViewportTabOrder,
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
    expect(useViewportStore.getState().tabs.map((tab) => tab.id)).toEqual([
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
    expect(state.tabs.map((tab) => tab.id)).toEqual([first, third]);
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
    expect(state.tabs.map((tab) => tab.id)).toEqual([second, first]);
    expect(state.activeTabId).toBe(first);
  });

  it("ignores a reorder that does not name exactly the current tabs", () => {
    const first = openViewportTerminal();
    const second = openViewportTerminal();

    setViewportTabOrder([first]);
    setViewportTabOrder([first, first]);

    expect(useViewportStore.getState().tabs.map((tab) => tab.id)).toEqual([
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

  it("clears every tab", () => {
    openViewportTerminal();
    openViewportTerminal();

    closeViewport();

    const state = useViewportStore.getState();
    expect(state.tabs).toHaveLength(0);
    expect(state.drawerOpen).toBe(false);
  });
});
