[2026-04-05 09:23] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "compile error - wrong fields",
    "EXPECTATION": "The Request Inspector should compile; use only valid ChatMessageResponse fields and extract performance metrics from the available data structure.",
    "NEW INSTRUCTION": "WHEN working with Ollama ChatMessageResponse in Rust THEN use existing fields; read metrics from response.final_data when available"
}

[2026-04-05 09:29] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "pending state not clearing",
    "EXPECTATION": "After a response arrives, the UI should stop showing 'Waiting for response' and reflect the actual responding/completed state.",
    "NEW INSTRUCTION": "WHEN first response chunk is received THEN set status to 'responding' and hide 'Waiting'"
}

[2026-04-05 09:32] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "missing response content",
    "EXPECTATION": "The Request Inspector (and chat UI) should capture and display the assistant’s response text.",
    "NEW INSTRUCTION": "WHEN a stream chunk includes message.content THEN append to assistant buffer and update inspector"
}

[2026-04-05 09:34] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "Inspector UI issues",
    "EXPECTATION": "Inspector panel should not overflow, the Clear button must work, and the toggle and close (X) controls should not overlap.",
    "NEW INSTRUCTION": "WHEN implementing InspectorPanel UI THEN use fixed header with scrollable body, wire Clear to reset logs, and separate toggle and close controls"
}

[2026-04-05 09:44] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "auth UI regression",
    "EXPECTATION": "User expects to see their profile on the bottom-left when logged in, and if not logged in, the authentication modal should automatically open.",
    "NEW INSTRUCTION": "WHEN app loads and user is unauthenticated THEN open the login/auth modal automatically"
}

[2026-04-05 09:48] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "profile not visible",
    "EXPECTATION": "The profile/avatar should appear in the bottom-left when logged in; if not logged in, the auth modal should automatically open.",
    "NEW INSTRUCTION": "WHEN auth state is authenticated THEN render the bottom-left profile avatar immediately"
}

[2026-04-05 09:51] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "profile render failure",
    "EXPECTATION": "After loading finishes, the bottom-left profile should replace the skeleton if authenticated; otherwise the auth modal should appear.",
    "NEW INSTRUCTION": "WHEN isLoading is false AND user is authenticated THEN render bottom-left profile avatar"
}

[2026-04-05 09:55] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "ollama fallback not working",
    "EXPECTATION": "When local Ollama is unavailable, the app should still use the configured Ollama API key/base URL to access cloud models.",
    "NEW INSTRUCTION": "WHEN local Ollama health check fails or connection errors THEN send requests using configured baseUrl and apiKey"
}

[2026-04-05 09:56] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "remove api key feature",
    "EXPECTATION": "Remove the Ollama API key/base URL configuration and related UI; rely on local Ollama only.",
    "NEW INSTRUCTION": "WHEN initializing or configuring Ollama client THEN ignore apiKey/baseUrl and use local defaults only"
}

[2026-04-05 13:15] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "model picker UI",
    "EXPECTATION": "The 'Set as default' item should be an action, not a selectable model; the dropdown should list only actual models.",
    "NEW INSTRUCTION": "WHEN rendering the model dropdown options THEN exclude action items like 'Set as default'"
}

[2026-04-05 13:22] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "target UI clarified",
    "EXPECTATION": "Keep the header dropdowns unchanged; update the EmptyState main text (which shows the model name) to say 'Hello, {username}'.",
    "NEW INSTRUCTION": "WHEN rendering EmptyState and two or more models are selected THEN show 'Hello, {username}' instead of model name"
}

