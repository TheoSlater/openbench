# Attachment validation and previews

## Goal

Chat attachments should clearly distinguish accepted files from rejected files
and let users inspect every accepted file before sending it. The flow remains
local-first and uses the existing image pipeline, drag/drop handling, AI SDK
mapping boundary, notification system, and UI primitives.

## Options considered

1. Keep square attachment chips and show validation errors only in toasts.
   Rejected: users cannot inspect text files and burst errors hide which files
   were accepted.
2. Add a full split-pane file inspector to the composer. Rejected: it adds a
   large persistent surface and state for a task that only needs a preview.
3. Extend the existing attachment list with explicit validation status and a
   click/keyboard preview dialog. Chosen: it is discoverable, responsive, local
   to the composer, and requires no new dependency.

## Supported file contract

Chat accepts:

- Images: JPEG, PNG, WebP, GIF, and AVIF; the existing 20 MiB file limit and
  8192 px maximum dimension remain in force.
- Text: TXT, Markdown (`.md`/`.markdown`), CSV, and JSON; each text file is
  limited to 1 MiB, matching the existing folder-context limit.
- A maximum of eight accepted attachments is enforced across both groups.

Validation checks the normalized MIME type and filename extension, infers a
known MIME type for native drag/drop paths that omit it, rejects unsupported or
mismatched files, and preserves valid files from a mixed selection. PDF,
Office, archive, and other binary formats are rejected until a real parser and
provider contract exist for them.

## Data flow

`useChatAttachments` validates the complete selection before adding files to
the draft. Images continue to use object URLs for immediate previews and are
materialized to base64 only when sending. Text files are read as UTF-8 for the
local preview and are encoded as a valid data URL at the AI SDK mapping
boundary, so raw text is not mislabeled as base64 provider content.

The existing extension map is expanded to cover the supported text formats and
is reused by browser and native drag/drop paths. Validation and read/decode
failures stay in the attachment flow; they do not create unusable draft
attachments.

## UI

The composer attachment area becomes a compact responsive list:

- Images show a thumbnail; text files show a file-type icon.
- Each item shows a truncated filename, human-readable size/type, a ready or
  processing state, and an accessible remove button.
- A live summary reports how many files are attached. Mixed selections produce
  one concise rejection summary with filenames and specific reasons, while
  accepted files remain visible so success is unambiguous.
- Activating an item with a click or keyboard opens a preview dialog. Images
  use a contained visual preview with dimensions and metadata. Text, Markdown,
  CSV, and JSON use a scrollable, selectable monospace preview with filename,
  type, and size. Long names and content remain bounded on small windows.
- The dialog is keyboard accessible, uses existing motion/reduced-motion
  behavior, and never implies that the file has been uploaded remotely.

Sent-message rendering keeps its existing compact image/file presentation; the
new inspector is for the draft decision point where users need to verify a
file before sending it.

## Error handling

- Unsupported type, extension mismatch, per-file size, count, image dimension,
  corrupt image, and text read failures have specific messages.
- A mixed batch accepts valid files and reports invalid files without stopping
  the whole batch.
- Empty or missing file contents cannot be sent as ready attachments.
- Text data is encoded correctly for providers that require data URLs; existing
  data URLs from folder context and persisted messages remain unchanged.
- Object URLs are released through the existing attachment lifecycle.

## Verification

- Add focused validation tests for supported formats, MIME inference, mixed
  accepted/rejected batches, count and size limits, and extension mismatches.
- Add focused UI/helper coverage for preview content, metadata, long names, and
  ready/error status.
- Run focused Vitest tests, the full Vitest suite, TypeScript checking, Vite
  build, and `git diff --check`.
- Confirm only attachment feature files and this spec/plan are staged; preserve
  all unrelated worktree changes.

## Scope

No new dependency, upload endpoint, remote file storage, PDF/Office parser,
native external-app viewer, or split-pane inspector is added.
