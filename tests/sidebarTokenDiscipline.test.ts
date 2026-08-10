import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = [
  "src/components/app-sidebar.tsx",
  "src/features/sidebar/components/sidebar-utils.tsx",
  "src/features/sidebar/components/SidebarBrand.tsx",
  "src/features/sidebar/components/FoldersSection.tsx",
  "src/features/sidebar/components/FolderTree.tsx",
  "src/features/sidebar/components/ConversationList.tsx",
  "src/features/sidebar/components/ConversationSkeleton.tsx",
  "src/features/chat/components/ConversationItem.tsx",
  "src/features/profile/ProfileMenu.tsx",
];

const forbiddenVisualPatterns = [
  /#[0-9a-f]{3,8}\b/i,
  /\brgba?\(/i,
  /fontSize:\s*(?:"\d|\d)/,
  /letterSpacing:\s*["'][^"']+["']/,
  /borderRadius:\s*["'](?:\d|50%|9999px)/,
  /transition:\s*["'][^"']*(?:ms|s|ease|cubic)/,
];

describe("sidebar visual tokens", () => {
  it("avoids hardcoded visual tokens in sidebar presentation files", () => {
    const offenders = files.flatMap((file) => {
      const source = readFileSync(file, "utf8");

      return forbiddenVisualPatterns.flatMap((pattern) =>
        pattern.test(source) ? [`${file}: ${pattern}`] : [],
      );
    });

    expect(offenders).toEqual([]);
  });
});
