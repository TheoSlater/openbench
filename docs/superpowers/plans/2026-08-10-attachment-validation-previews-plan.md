# Attachment validation and previews implementation plan

Design: `docs/superpowers/specs/2026-08-10-attachment-validation-previews-design.md`

## 1. Make the supported file contract canonical

- Extend `src/lib/image-upload/config.ts` with the shared eight-file limit and
  one MiB text limit while preserving the existing image limits.
- Extend `src/lib/image-upload/validation.ts` with the supported text MIME and
  extension map, MIME inference for native drops, and mixed-file validation.
- Keep `validateImageFiles` as the onboarding image-specific wrapper and use
  the shared map for `useFileDragDetection` so browser and native drops agree.
- Add focused tests for valid formats, missing MIME types, extension mismatch,
  mixed batches, file limits, and per-kind size limits.

## 2. Process valid attachments safely

- Update `src/features/chat/hooks/useChatAttachments.ts` to validate all
  selected files, count images and text together, preserve valid selections,
  and report rejected files in one concise notification.
- Normalize the attachment MIME type before storing it. Keep the existing
  object-URL/image-dimension/optimization path; read accepted text files as
  UTF-8 and surface reader failures without leaving sendable empty entries.
- Add the smallest Zustand action needed to replace an attachment in place so
  processing and ready states update without mutating store state silently.
- Keep removal and send cleanup on the existing object URL lifecycle.

## 3. Build the draft inspector UI

- Replace the square-only presentation in
  `src/features/chat/components/ChatInput/ChatAttachmentsList.tsx` with a
  compact responsive item row containing thumbnail/icon, filename, type/size,
  status, remove action, and a keyboard-accessible preview trigger.
- Add the preview dialog using existing dialog primitives: contained image
  preview with dimensions, or a bounded selectable `<pre>` preview for text,
  Markdown, CSV, and JSON.
- Add a live attachment count/status summary and preserve reduced-motion,
  focus-visible, truncation, and small-window behavior.

## 4. Keep provider payloads correct

- Update `src/lib/ai/messages.ts` so raw text attachment content is UTF-8
  base64 encoded into a data URL before becoming an AI SDK file part.
- Preserve existing data URLs from folder context and persisted messages.
- Add focused mapping tests for raw Unicode text, existing data URLs, and image
  content.

## 5. Verify the feature

- Run focused attachment/drag/mapping tests first.
- Run the full Vitest suite, TypeScript check, Vite build, and `git diff
  --check`.
- Review the final diff and stage only the attachment files plus the committed
  design/plan; leave all unrelated dirty-tree changes untouched.
