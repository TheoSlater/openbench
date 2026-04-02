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

