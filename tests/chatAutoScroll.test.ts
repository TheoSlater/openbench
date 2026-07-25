import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "src/features/chat/components/ChatArea.tsx",
  "utf8",
);
const scrollButtonSource = readFileSync(
  "src/components/ui/scroll-button.tsx",
  "utf8",
);

/** The className string on the element that carries `ref={setScrollRef}`. */
function scrollContainerClasses(): string {
  const at = source.indexOf("ref={setScrollRef}");
  expect(at).toBeGreaterThan(-1);
  const className = source.slice(at).match(/className="([^"]+)"/);
  expect(className).not.toBeNull();
  return className![1];
}

describe("chat auto-scroll", () => {
  it("keeps the scroll container out of flex layout", () => {
    // use-stick-to-bottom drives auto-scroll from a ResizeObserver on the
    // content element. As a flex row with a definite height, `align-items:
    // stretch` pins that child's height to the container's, so it never grows,
    // the observer never fires, and neither sending a message nor streaming a
    // reply scrolls anything.
    expect(scrollContainerClasses().split(/\s+/)).not.toContain("flex");
  });

  it("still scrolls vertically", () => {
    expect(scrollContainerClasses()).toContain("overflow-y-auto");
  });

  it("scrolls down when a new user message arrives, wherever you were", () => {
    // Sending is explicit, so it overrides an escaped stick lock. Keyed on the
    // newest user message so streaming assistant tokens never trigger it.
    expect(source).toContain("lastUserMessageId");
    expect(source).toMatch(/ignoreEscapes:\s*true/);
  });

  it("renders the scroll button outside the scroll container", () => {
    // An absolutely positioned descendant of a scrolling element scrolls away
    // with the content, which is where the previous button lived.
    const scrollEnd = source.indexOf("<ScrollButton");
    const containerClose = source.lastIndexOf("</Box>", scrollEnd);
    expect(scrollEnd).toBeGreaterThan(-1);
    expect(containerClose).toBeLessThan(scrollEnd);
    expect(source).toContain("<StickToBottom");
  });

  it("shows the shared spinner while generating and restores the arrow on hover", () => {
    expect(source).toMatch(/<ScrollButton[\s\S]*loading=\{isResponding\}/);
    expect(scrollButtonSource).toContain('import { CircularProgress } from "@/components/ui/spinner"');
    expect(scrollButtonSource).toContain("<CircularProgress");
    expect(scrollButtonSource).toContain("group-hover:hidden");
    expect(scrollButtonSource).toContain("group-hover:block");
  });
});
