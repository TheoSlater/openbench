# PolyUI README redesign

## Audience and goal

The primary reader is an end user deciding whether to download PolyUI. The first screen must answer what PolyUI is, show the real product, and make the next action obvious with minimal reading.

## Scope

- Rewrite `README.md` in place.
- Keep the existing PolyUI logo, product name, badges, and `public/PolyUI_Demo.png` as the opening proof.
- Preserve accurate install, offline, privacy, provider, agent-permission, contribution, roadmap, support, and license information where it helps a user make a decision or use the project.
- Remove repeated promises, the long highlights list, and architecture/FAQ prose that duplicates the short product explanation.
- Do not create generated artwork, new README-specific SVGs, GIFs, or unrelated source changes.

## Information architecture

1. Centered identity: logo, name, one-line value statement, badges, and short navigation links.
2. Full-width demo screenshot with descriptive alt text.
3. A short “What you need to know” section covering local and hosted models, coding agents, and local data/credential handling.
4. Download-first installation with the GitHub Releases link, platform packages, and the two supported command-line installers.
5. One concise offline/privacy/limitations note, including the AppImage availability caveat.
6. A compact “For contributors” section with development, test, build, and architecture links/details.
7. Short FAQ only for decisions not already answered above, followed by contributing, roadmap, support, and license.

The release/download path is the primary call to action. Roadmap and issues remain discoverable but do not compete with downloading.

## Visual system

- Use GitHub’s native page surface and typography.
- Keep the current dark PolyUI icon and blue/black product screenshot as the visual identity.
- Reduce the logo’s rendered size from the current oversized opening treatment.
- Keep the existing flat-square badge grammar in one compact row.
- Use minimal HTML only for alignment and image sizing; keep all copy as searchable Markdown.
- Use forward-slash relative image paths (`./public/...`) and meaningful alt text.
- Do not add decorative backgrounds, generated hero art, external fonts, scripts, or animation.

## Content rules

- State outcomes in plain language before implementation details.
- Mention provider/network boundaries once and keep the local-first behavior explicit.
- Keep exact commands and frequently changing links in Markdown, never inside an image.
- Do not invent adoption, benchmarks, compatibility, or user testimonials.
- Keep the existing technical limitations visible when they affect installation or privacy expectations.

## Validation

- Confirm the README diff only changes the intended homepage content and image paths.
- Run the repository’s README audit script if available.
- Check all local image references, links, headings, code fences, and badges.
- Review the opening at normal GitHub content width and a narrow mobile width.
- Run no application test suite because this change does not alter application code.

## Deliberately untouched

The existing dirty changes in `.env.example`, `AGENTS.md`, `src-tauri/Cargo.toml`, onboarding files/tests, and deleted documentation remain untouched. The existing images under `public/` remain untouched.
