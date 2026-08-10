# Coding Agent Icons

## Scope

Use the existing `public/icons/codex.svg` and `public/icons/claude.svg` assets anywhere the shared runtime UI presents Codex or Claude Code as a selectable model or provider card.

## Treatment

- Render the bare glyph without a tile, border, badge, or brand-colored background.
- Use an 18px icon in model-picker rows and a 20px icon in coding-agent provider cards.
- Let the SVG inherit the current foreground color so it works in every theme and state.
- Keep the adjacent text labels as the accessible names; the icons are decorative and use empty alternative text.
- Preserve existing row heights, card density, status controls, selection indicators, and interaction behavior.

## Mapping

- `codex` uses `/icons/codex.svg`.
- `claude-code` uses `/icons/claude.svg`.

## Verification

- Both agents show the correct icon in the model picker and Settings cards.
- Loading, ready, unavailable, selected, hover, dark-theme, and narrow-width states remain aligned.
- TypeScript, focused presentation tests, and the production build pass.
