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

