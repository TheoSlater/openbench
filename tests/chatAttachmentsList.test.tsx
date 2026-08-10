// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatAttachmentsList } from "@/features/chat/components/ChatInput/ChatAttachmentsList";

describe("chat attachment previews", () => {
  it("reports ready files and opens a text preview from the attachment row", () => {
    render(
      <ChatAttachmentsList
        attachments={[{
          id: "text-1",
          name: "notes.md",
          type: "text/markdown",
          size: 12,
          content: "# Notes\n\nA local preview.",
          status: "ready",
        }]}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getByRole("status").textContent).toContain("1 of 1 ready");
    fireEvent.click(screen.getByRole("button", { name: "Preview notes.md" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain("# Notes");
    expect(dialog.textContent).toContain("A local preview.");
  });

  it("keeps preview unavailable while a file is preparing", () => {
    render(
      <ChatAttachmentsList
        attachments={[{
          id: "image-1",
          name: "photo.png",
          type: "image/png",
          size: 42,
          status: "previewing",
        }]}
        onRemove={vi.fn()}
      />,
    );

    const previewButton = screen.getByRole("button", { name: "photo.png is still preparing" });
    expect(previewButton).toHaveProperty("disabled", true);
    expect(screen.getByRole("status").textContent).toContain("0 of 1 ready");
  });

  it("opens an image preview with the draft object URL", () => {
    render(
      <ChatAttachmentsList
        attachments={[{
          id: "image-2",
          name: "photo.png",
          type: "image/png",
          size: 42,
          width: 1200,
          height: 800,
          previewUrl: "blob:photo-preview",
          status: "ready",
        }]}
        onRemove={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview photo.png" }));

    expect(screen.getByRole("img", { name: "photo.png" }).getAttribute("src")).toBe("blob:photo-preview");
    expect(screen.getByRole("dialog").textContent).toContain("1200 × 800 px");
  });
});
