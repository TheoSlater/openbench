import { describe, expect, it } from "vitest";
import {
  attachmentMimeType,
  validateAttachmentFiles,
} from "@/lib/image-upload/validation";

function file(name: string, type: string, content = "content") {
  return new File([content], name, { type });
}

describe("attachment validation", () => {
  it("accepts supported images and text files", () => {
    const markdown = file("notes.md", "text/plain", "# Notes");
    const result = validateAttachmentFiles([
      file("photo.png", "image/png"),
      markdown,
      file("data.json", "application/json", "{\"ok\":true}"),
    ]);

    expect(result.accepted).toHaveLength(3);
    expect(result.errors).toEqual([]);
    expect(attachmentMimeType(markdown)).toBe("text/markdown");
  });

  it("infers a supported MIME type when native drag/drop omits it", () => {
    const dropped = file("table.csv", "", "a,b\n1,2");

    expect(attachmentMimeType(dropped)).toBe("text/csv");
    expect(validateAttachmentFiles([dropped])).toMatchObject({
      accepted: [dropped],
      errors: [],
    });
  });

  it("keeps valid files from a mixed selection and explains rejected files", () => {
    const valid = file("readme.txt", "text/plain");
    const unsupported = file("report.pdf", "application/pdf");
    const mismatch = file("image.png", "image/jpeg");

    const result = validateAttachmentFiles([valid, unsupported, mismatch]);

    expect(result.accepted).toEqual([valid]);
    expect(result.errors.map((error) => error.code)).toEqual([
      "unsupported-type",
      "invalid-extension",
    ]);
    expect(result.errors.map((error) => error.fileName)).toEqual([
      "report.pdf",
      "image.png",
    ]);
  });

  it("enforces the shared count and text size limits", () => {
    const files = [
      file("one.txt", "text/plain"),
      file("two.txt", "text/plain"),
      file("three.txt", "text/plain"),
    ];
    const tooLarge = file("large.md", "text/markdown", "x".repeat(1024 * 1024 + 1));

    const result = validateAttachmentFiles([...files, tooLarge], { maxFiles: 2 });

    expect(result.accepted.map((item) => item.name)).toEqual(["one.txt", "two.txt"]);
    expect(result.errors.map((error) => error.code)).toEqual([
      "too-many-files",
      "file-too-large",
    ]);
  });

  it("rejects empty files", () => {
    const result = validateAttachmentFiles([file("empty.txt", "text/plain", "")]);

    expect(result.accepted).toEqual([]);
    expect(result.errors[0]).toMatchObject({
      code: "empty-file",
      fileName: "empty.txt",
    });
  });
});
