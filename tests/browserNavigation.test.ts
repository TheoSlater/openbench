import { moveBrowserHistory, pushBrowserHistory, resolveBrowserInput } from "../src/features/viewport/browserNavigation";

describe("browser navigation input", () => {
  it("keeps full http urls", () => {
    expect(resolveBrowserInput("https://example.com/docs")).toBe("https://example.com/docs");
  });

  it("opens domains as pages", () => {
    expect(resolveBrowserInput("example.com/docs")).toBe("https://example.com/docs");
  });

  it("uses http for local dev addresses", () => {
    expect(resolveBrowserInput("127.0.0.1:5173")).toBe("http://127.0.0.1:5173");
    expect(resolveBrowserInput("localhost:4173/demo")).toBe("http://localhost:4173/demo");
  });

  it("uses Google for plain searches", () => {
    expect(resolveBrowserInput("pricing page inspiration")).toBe(
      "https://www.google.com/search?q=pricing+page+inspiration",
    );
  });

  it("ignores blank input", () => {
    expect(resolveBrowserInput("  ")).toBeNull();
  });
});

describe("browser history", () => {
  it("pushes new pages and moves back and forward", () => {
    let state = pushBrowserHistory({ entries: [], index: -1 }, "https://a.test/");
    state = pushBrowserHistory(state, "https://b.test/");

    let moved = moveBrowserHistory(state, -1);
    expect(moved.url).toBe("https://a.test/");
    expect(moved.state.index).toBe(0);

    moved = moveBrowserHistory(moved.state, 1);
    expect(moved.url).toBe("https://b.test/");
    expect(moved.state.index).toBe(1);
  });

  it("drops forward history after a new page", () => {
    let state = pushBrowserHistory({ entries: [], index: -1 }, "https://a.test/");
    state = pushBrowserHistory(state, "https://b.test/");
    state = moveBrowserHistory(state, -1).state;
    state = pushBrowserHistory(state, "https://c.test/");

    expect(state).toEqual({ entries: ["https://a.test/", "https://c.test/"], index: 1 });
  });
});
