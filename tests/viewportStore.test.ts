import {
  openEmptyViewport,
  openViewportForUser,
  closeViewportBrowser,
  useViewportStore,
} from "../src/features/viewport/viewportStore";

const resetViewportStore = () => {
  useViewportStore.setState({
    session: null,
    browserOpen: false,
    drawerOpen: false,
    drawerWidth: 440,
  });
};

describe("viewport drawer state", () => {
  beforeEach(resetViewportStore);

  it("opens an empty browser drawer", () => {
    openEmptyViewport();

    expect(useViewportStore.getState()).toMatchObject({
      drawerOpen: true,
      browserOpen: true,
      session: null,
    });
  });

  it("opens user links as iframe preview sessions", async () => {
    await openViewportForUser("https://example.com");

    expect(useViewportStore.getState()).toMatchObject({
      drawerOpen: true,
      browserOpen: true,
      session: {
        openedBy: "user",
        url: "https://example.com/",
        status: "ready",
      },
    });
  });

  it("ignores non-http preview urls", async () => {
    await openViewportForUser("javascript:alert(1)");

    expect(useViewportStore.getState().session).toBeNull();
    expect(useViewportStore.getState().drawerOpen).toBe(false);
  });

  it("closes the browser drawer", async () => {
    await openViewportForUser("https://example.com");
    closeViewportBrowser();

    expect(useViewportStore.getState()).toMatchObject({
      drawerOpen: false,
      browserOpen: false,
      session: null,
    });
  });
});
