[2026-04-02 17:26] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Modal responsiveness",
    "EXPECTATION": "SettingsModal should be usable on small windows with visible close controls and accessible action buttons.",
    "NEW INSTRUCTION": "WHEN a modal renders on small screens THEN show a visible Close control and keep footer actions visible."
}

[2026-04-02 17:33] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Deletion not working",
    "EXPECTATION": "Clicking the delete icon in the SettingsModal should remove the selected item and reflect immediately in the UI.",
    "NEW INSTRUCTION": "WHEN the delete icon in SettingsModal is clicked THEN delete the targeted item and refresh the list/state."
}

[2026-04-02 17:36] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Post-save modal close",
    "EXPECTATION": "After successfully saving (Save changes or Save as new), the SettingsModal should close automatically.",
    "NEW INSTRUCTION": "WHEN a SettingsModal save completes successfully THEN close the SettingsModal immediately."
}

[2026-04-02 17:44] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Right panel overflow",
    "EXPECTATION": "The SettingsModal right panel should be width-constrained, independently scrollable, with clear spacing so no text or controls are cut off or overlapping.",
    "NEW INSTRUCTION": "WHEN the SettingsModal right panel renders THEN constrain its width, enable overflow-y-auto, and apply consistent padding and section gaps."
}

[2026-04-02 17:46] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Right panel overflow",
    "EXPECTATION": "The SettingsModal right panel and header should never be cut off; the body must be height-constrained and independently scrollable so all text and controls are visible.",
    "NEW INSTRUCTION": "WHEN the SettingsModal opens THEN set max-h-[85vh] and overflow-y-auto on the body."
}

[2026-04-02 17:50] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Modal content cutoff",
    "EXPECTATION": "SettingsModal content should not be cut off; header visible, right panel width-constrained, and body scrolls independently on small windows.",
    "NEW INSTRUCTION": "WHEN the SettingsModal right panel/body render inside flex containers THEN add min-h-0 and min-w-0 to flex children and overflow-y-auto on the body."
}

[2026-04-02 17:53] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Parent container restriction",
    "EXPECTATION": "Parent containers (e.g., App.tsx) should not constrain the SettingsModal’s width or cause content cutoff.",
    "NEW INSTRUCTION": "WHEN modal content is cut off THEN remove restrictive parent widths and add min-w-0."
}

[2026-04-02 17:58] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Close button placement",
    "EXPECTATION": "The SettingsModal close button should appear at the top-left, matching the provided screenshot.",
    "NEW INSTRUCTION": "WHEN the SettingsModal renders THEN place a visible Close control in the top-left of the header."
}

[2026-04-02 18:22] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "SettingsModal layout",
    "EXPECTATION": "SettingsModal must not be cut off on small windows; header and close control remain visible, right panel is width-constrained, body scrolls independently, delete acts immediately, and successful saves auto-close the modal.",
    "NEW INSTRUCTION": "WHEN working on the SettingsModal layout or behavior THEN ensure body max-h-85vh overflow-y-auto and visible top-left Close button"
}

[2026-04-02 19:00] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "SettingsModal layout",
    "EXPECTATION": "SettingsModal must not be cut off on small windows; header and top-left close remain visible, right panel width-constrained, body scrolls independently, delete acts immediately, and successful saves auto-close the modal.",
    "NEW INSTRUCTION": "WHEN working on the SettingsModal layout or behavior THEN ensure body max-h-85vh overflow-y-auto and visible top-left Close button."
}

[2026-04-02 19:09] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Input color regression",
    "EXPECTATION": "Input fields should retain correct theme colors (text, background, border) and remain readable after layout/style changes.",
    "NEW INSTRUCTION": "WHEN editing Dialog or shared UI styles THEN avoid overriding input text/background colors; use theme tokens."
}

[2026-04-02 19:12] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Chat input styling",
    "EXPECTATION": "The chat input should have a visible outline and subtle elevation to separate it from the background.",
    "NEW INSTRUCTION": "WHEN rendering the chat input bar THEN add a visible outline and subtle elevation shadow."
}

[2026-04-02 19:14] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Input styling fidelity",
    "EXPECTATION": "Input fields should match the reference screenshot’s colors, elevation, and border outline.",
    "NEW INSTRUCTION": "WHEN implementing or updating inputs with a provided reference screenshot THEN match background/text colors, border outline, and elevation to it."
}

[2026-04-02 19:15] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Excessive elevation",
    "EXPECTATION": "UI should use minimal, subtle elevation; avoid heavy or stacked drop shadows.",
    "NEW INSTRUCTION": "WHEN adding elevation or shadows THEN use a subtle single-layer shadow or none."
}

[2026-04-02 19:15] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Border radius",
    "EXPECTATION": "The SettingsModal corners should be less rounded to match the reference.",
    "NEW INSTRUCTION": "WHEN styling the SettingsModal container THEN reduce the corner radius to a subtler value."
}

[2026-04-02 19:27] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Sidebar button jump",
    "EXPECTATION": "Sidebar toggle should not cause header/action buttons to shift or move with the sidebar.",
    "NEW INSTRUCTION": "WHEN the sidebar opens or closes THEN render it as an overlay and keep header buttons fixed."
}

[2026-04-02 19:30] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Sidebar/header alignment",
    "EXPECTATION": "The sidebar collapse toggle should fully align to the edge when collapsed, and the New Chat icon button should be visually centered within its container.",
    "NEW INSTRUCTION": "WHEN rendering the sidebar header controls THEN align collapse toggle flush-left/right and center the New Chat icon."
}

[2026-04-02 19:32] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Sidebar collapse animation",
    "EXPECTATION": "Sidebar collapse/expand should not cause header/action buttons to snap; movement must be smooth with no layout shift.",
    "NEW INSTRUCTION": "WHEN collapsing or expanding the sidebar THEN render it as an overlay and animate translateX, not width."
}

[2026-04-02 23:27] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "SettingsModal layout",
    "EXPECTATION": "SettingsModal remains fully usable on small windows: header and top-left Close visible, body scrolls independently, right panel width-constrained; deletes act immediately; successful saves auto-close.",
    "NEW INSTRUCTION": "WHEN the SettingsModal opens THEN keep header visible and body overflow-y-auto max-h-[85vh]."
}

[2026-04-02 23:30] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "SettingsModal layout usability",
    "EXPECTATION": "SettingsModal must remain fully usable on small windows: header with top-left Close always visible, body independently scrollable with max height, right panel width-constrained; deletes act immediately; successful saves auto-close.",
    "NEW INSTRUCTION": "WHEN implementing SettingsModal THEN fix header with top-left Close and make body scrollable"
}

[2026-04-02 23:32] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "SettingsModal usability",
    "EXPECTATION": "SettingsModal must remain fully usable on small windows: header with top-left Close always visible, body independently scrollable with max height, right panel width-constrained; deletes act immediately; successful saves auto-close.",
    "NEW INSTRUCTION": "WHEN working on SettingsModal layout or behavior THEN keep header/top-left Close visible and body max-h-85vh overflow-y-auto"
}

[2026-04-02 23:45] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "EmptyState prompts/layout",
    "EXPECTATION": "EmptyState should not show suggested prompts; only the model name with the chat input centered below until messages exist.",
    "NEW INSTRUCTION": "WHEN rendering EmptyState with no messages THEN hide suggested prompts and center ChatInput below the model name"
}

[2026-04-02 23:45] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "EmptyState prompts/layout",
    "EXPECTATION": "EmptyState should not display suggested prompts; it should show only the model name with the chat input centered below until messages exist.",
    "NEW INSTRUCTION": "WHEN rendering EmptyState with no messages THEN hide suggested prompts and center ChatInput below the model name"
}

[2026-04-02 23:46] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Model name casing",
    "EXPECTATION": "The model name should display in its original casing, not forced to uppercase.",
    "NEW INSTRUCTION": "WHEN rendering model name text THEN do not transform case; remove uppercase classes/styles."
}

[2026-04-02 23:47] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "ChatInput overflow",
    "EXPECTATION": "The ChatInput should not have its own inner scroll; it should expand slightly and let the main content area handle scrolling.",
    "NEW INSTRUCTION": "WHEN ChatInput text exceeds one line THEN auto-resize textarea and prevent inner scrolling"
}

[2026-04-03 00:00] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Missing chat context",
    "EXPECTATION": "The AI should retain and use prior messages within the same chat so replies are contextual.",
    "NEW INSTRUCTION": "WHEN sending a prompt to the AI THEN include the full ordered conversation history for that chat."
}

[2026-04-03 00:02] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Shimmer visibility",
    "EXPECTATION": "The sidebar chat title should show a text shimmer whenever the AI is actively processing/streaming.",
    "NEW INSTRUCTION": "WHEN a conversation is streaming or running THEN wrap its sidebar title with TextShimmer"
}

[2026-04-03 09:06] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Cancel handling",
    "EXPECTATION": "Canceling an in-flight AI response should fully stop it so the next send only processes the new message.",
    "NEW INSTRUCTION": "WHEN a response is canceled THEN abort request, clear streaming state, ignore late events."
}

[2026-04-03 09:25] - Updated by Junie
{
    "TYPE": "negative",
    "CATEGORY": "Sidebar visual mismatch",
    "EXPECTATION": "The sidebar should visually match the referenced screenshot precisely.",
    "NEW INSTRUCTION": "WHEN implementing or updating the sidebar with a provided screenshot THEN match layout, spacing, colors, and alignment to it"
}

[2026-04-03 09:37] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Revert UI changes",
    "EXPECTATION": "Restore the previous sidebar design and related UI that existed before the recent minimal cleanup.",
    "NEW INSTRUCTION": "WHEN working on the Sidebar layout THEN restore original sections and profile footer from earlier version."
}

[2026-04-03 09:46] - Updated by Junie
{
    "TYPE": "negative",
    "CATEGORY": "Sidebar buttons misalignment",
    "EXPECTATION": "Sidebar buttons should work correctly and be visually centered/aligned within their containers.",
    "NEW INSTRUCTION": "WHEN rendering sidebar header and menu buttons THEN center contents and ensure full-width clickable targets."
}

[2026-04-03 09:48] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Sidebar/header alignment",
    "EXPECTATION": "All sidebar header/buttons should be centered within their containers; icons centered inside buttons.",
    "NEW INSTRUCTION": "WHEN rendering sidebar header/action buttons THEN center icons with flex items-center justify-center and full hit-area."
}

[2026-04-03 11:16] - Updated by Junie
{
    "TYPE": "preference",
    "CATEGORY": "MUI refactor safeguards",
    "EXPECTATION": "During the MUI migration, SettingsModal must retain its small-window usability: fixed header with a visible top-left Close, independently scrollable body with constrained height, and right panel width constraints.",
    "NEW INSTRUCTION": "WHEN migrating SettingsModal to MUI THEN fix header, top-left Close; body max-h 85vh scroll"
}

[2026-04-03 11:25] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Broken imports",
    "EXPECTATION": "After the MUI refactor, legacy ui/* imports must still resolve or be updated so the app runs without missing module errors.",
    "NEW INSTRUCTION": "WHEN deleting or moving ui components THEN update all import paths or add compatibility wrappers at original paths."
}

[2026-04-03 11:57] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Missing provider",
    "EXPECTATION": "Components that call useSidebar (e.g., SidebarTrigger) must be rendered within a SidebarProvider so they don’t throw at runtime.",
    "NEW INSTRUCTION": "WHEN using SidebarTrigger or useSidebar THEN wrap the tree with SidebarProvider at the app shell."
}

[2026-04-03 11:58] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Sidebar collapse regression",
    "EXPECTATION": "The sidebar should collapse to an icon-only rail when toggled, reducing width and hiding labels.",
    "NEW INSTRUCTION": "WHEN the sidebar is collapsed THEN set width to 60px, hide labels, keep icons centered."
}

[2026-04-03 22:50] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Chat input adjustments",
    "EXPECTATION": "The chat input should only show an outline when focused, be less rounded and shorter, and the settings (cog) icon should be removed.",
    "NEW INSTRUCTION": "WHEN rendering ChatInput THEN show outline only on focus and remove settings icon"
}

[2026-04-03 22:53] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "ChatInput rounding",
    "EXPECTATION": "The chat input should be slightly more rounded than the last revision and any resulting errors should be resolved.",
    "NEW INSTRUCTION": "WHEN styling ChatInput container THEN set borderRadius to 14px."
}

[2026-04-03 22:58] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Theme tokens usage",
    "EXPECTATION": "Colors should come from src/theme.ts (MUI theme tokens) instead of hardcoded hex values.",
    "NEW INSTRUCTION": "WHEN needing a new color in UI THEN add it to src/theme.ts and reference theme tokens."
}

[2026-04-03 23:09] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Sidebar layout controls",
    "EXPECTATION": "In expanded view, show a New Chat button above RECENT; place the collapse icon at the top-right next to the OpenBench title. In collapsed view, show only New Chat, Settings, and Uncollapse icons.",
    "NEW INSTRUCTION": "WHEN the sidebar is expanded THEN place New Chat above RECENT and collapse control top-right"
}

[2026-04-03 23:13] - Updated by Junie
{
    "TYPE": "preference",
    "CATEGORY": "No hardcoded colors",
    "EXPECTATION": "All frontend colors must come from src/theme.ts; no hex or rgba literals anywhere.",
    "NEW INSTRUCTION": "WHEN specifying a color in frontend styles THEN use theme tokens from src/theme.ts and avoid literals."
}

[2026-04-03 23:15] - Updated by Junie
{
    "TYPE": "preference",
    "CATEGORY": "Light mode support",
    "EXPECTATION": "Light mode should function correctly after the theme refactor with safe defaults.",
    "NEW INSTRUCTION": "WHEN running the app in light mode THEN verify all surfaces use theme tokens and maintain contrast."
}

[2026-04-03 23:20] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "SettingsModal size consistency",
    "EXPECTATION": "SettingsModal should keep a consistent width and height across tabs; only the inner body should scroll.",
    "NEW INSTRUCTION": "WHEN SettingsModal tab changes THEN preserve modal dimensions; scroll body content instead of resizing."
}

[2026-04-03 23:24] - Updated by Junie
{
    "TYPE": "preference",
    "CATEGORY": "Theme tokens usage",
    "EXPECTATION": "Use white color at 100% opacity and source it from src/theme.ts, not hardcoded.",
    "NEW INSTRUCTION": "WHEN specifying white in UI styles THEN use theme token and set opacity to 1"
}

[2026-04-04 17:30] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Ollama LocalModel fields",
    "EXPECTATION": "Use actual ollama-rs types; do not access a non-existent `details` field on `LocalModel` when detecting vision support.",
    "NEW INSTRUCTION": "WHEN determining vision support for a local model THEN call model info/show API and read families."
}

[2026-04-04 21:04] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Vision image handling",
    "EXPECTATION": "When an image is uploaded, the multimodal model should receive it and respond using the image content, not say it can't see it.",
    "NEW INSTRUCTION": "WHEN a message has image attachments THEN include base64 images and route to a vision-capable model"
}

[2026-04-04 21:27] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Rust dependency conflict",
    "EXPECTATION": "The Tauri app should build and run without sqlx/libsqlite3-sys version conflicts.",
    "NEW INSTRUCTION": "WHEN adding or updating sqlx or tauri-plugin-sql deps THEN align on one sqlx major and avoid duplicate links"
}

[2026-04-04 21:51] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Login theming issues",
    "EXPECTATION": "The Login/Auth page should use MUI-only styling with colors from theme.ts and no hardcoded color literals or shadcn-style appearance.",
    "NEW INSTRUCTION": "WHEN rendering Auth/Login components THEN use MUI-only styling and theme.ts colors"
}

[2026-04-04 22:03] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Modal size consistency",
    "EXPECTATION": "The Archived Chats modal should not be narrow; modal dimensions should be consistent across the app via a shared modal component.",
    "NEW INSTRUCTION": "WHEN implementing any modal THEN use a shared Modal with consistent width and max-h 85vh, scrollable body"
}

[2026-04-05 08:41] - Updated by Junie
{
    "TYPE": "negative",
    "CATEGORY": "Login modal broken UI",
    "EXPECTATION": "The Login modal should render in a portal with a fixed overlay, be centered, use correct z-index, avoid overlapping background elements, and have tabs that switch content via state.",
    "NEW INSTRUCTION": "WHEN implementing or fixing the Login modal THEN use a portal with fixed overlay, center container, set z-index 1000/1001, and switch tabs via state."
}

[2026-04-05 09:08] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "New Chat creation behavior",
    "EXPECTATION": "Clicking New Chat should not pre-create a chat named 'New Chat'; it should show the EmptyState and only create the chat when the user sends the first message.",
    "NEW INSTRUCTION": "WHEN New Chat is clicked with no messages THEN do not create chat; create on first send"
}

