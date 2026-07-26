# Spike: CEF offscreen rendering as the agent viewport

Branch: `spike/cef-osr`. Research spike — prove, don't polish.

Status: **superseded — the spike shipped**. The idle-spin blocker described below was
fixed in `c2fde0d fix(cef): remove idle spin and shrink runtime` (external message pump
scheduled as one-shot GLib timeouts; see `cef_osr.rs`), input forwarding landed in
`5a499a5` (CP4), and the feature merged to `main` behind the experimental Chromium
browser toggle (Linux only, off by default). The sections below are the historical
record of the spike and no longer describe the current code.

**Superseded again:** CEF now runs in a separate `polyui-viewport` process
(`src-tauri/viewport/`), downloaded on demand rather than linked into the app.
That resolved several problems this document treats as constraints:

- The CP1 idle-spin and the whole `do_message_loop_work` / `external_message_pump`
  question were artifacts of sharing a process with Tauri's GTK loop. The helper
  uses `multi_threaded_message_loop` with no GTK of its own.
- "Every CEF child process is a full copy of the polyui binary" (CP1, *Integration
  points that fought back*) is fixed: the helper is 0.7MB and links no ONNX,
  whisper or sqlx.
- macOS is no longer excluded by construction — a helper binary is exactly the
  shape CEF wants there. Bundling and signing remain.
- The CP2 PNG artifact this document admits was never produced now exists:
  `node scripts/viewport-smoke.mjs`.

## Pinned versions

| Thing | Version |
| --- | --- |
| `cef` crate (cef-rs) | `150.0.0+150.0.10` |
| CEF binary distribution | `cef_binary_150.0.10+g8042e43+chromium-150.0.7871.101_linux64_minimal` |
| Chromium | `150.0.7871.101` |
| Upstream | `github.com/tauri-apps/cef-rs` (same org as Tauri) |

Target platform: **Linux x86_64** (Ubuntu 24.04, kernel 6.17, rustc 1.96.0). Chosen because
it is the dev machine and because the repo's existing native viewport already has Linux GTK
glue to borrow from. macOS packaging is out of scope (see "macOS requirements").

## Premise correction (found before any code was written)

The task brief states the viewport is an iframe and that "native child webviews were rejected
because of the airspace problem". Neither matches `main`. The real history:

| Commit | What it did |
| --- | --- |
| `57f18bd feat(agent): add agent viewport` | iframe |
| `1e96cc3 feat(agent): embed viewport natively` | **dropped the iframe, went native** — commit body cites *"double-load, X-Frame-Options blanks"* |
| `71271bd feat(ui): improve viewport drawer` | **put the iframe back**, deleted the `agentViewportSetBounds` call, flipped `agentViewportHide()` to fire when the drawer *opens* |

So native webviews were never "rejected" — they were built, specifically to fix the iframe,
and then a UI-polish commit silently reverted the fix.

### Current state of `main` (both viewports exist, one is orphaned)

- `viewportStore.ts:204` calls `native.agentViewportOpen` → opens the native webview.
- `AgentViewportDrawer.tsx` immediately calls `native.agentViewportHide()` when the drawer opens.
- `AgentViewportDrawer.tsx:523` renders an `<iframe src={session.url}>` over the same URL.
- `native.ts:100` still exports `agentViewportSetBounds`, **called from nowhere**.

Net: the native viewport is opened, hidden, and never positioned. The X-Frame-Options blanking
that `1e96cc3` fixed is back in production.

### Why this strengthens the spike rather than killing it

`71271bd` hiding the native webview the instant the drawer opens is the airspace problem,
unstated in the commit message: the native webview composited over the drawer's own chrome.
That makes both surfaces dead ends, which is the real justification for OSR:

- **iframe** → dies on X-Frame-Options / CSP / frame-busting (evidenced, `1e96cc3`)
- **native child webview** → dies on airspace, overlays render underneath (implied, `71271bd`)

CEF OSR escapes both: no framing policy applies (a real browser fetches the page, not a frame),
and no airspace applies (the page is a `<canvas>` in the normal DOM).

Decision (confirmed with repo owner): **unify on CEF** — the OSR canvas replaces the drawer's
iframe *and* retires `agent_viewport.rs` and its hide/bounds/suspend machinery. One viewport.

## CP1 — CEF initializes and pumps

### Build setup (Linux x86_64)

No manual vendoring. `cef-dll-sys`'s `build.rs` downloads and extracts the CEF binary
distribution itself.

```bash
# Pin the download location — see note below on why this matters.
export CEF_PATH=$HOME/.cache/cef
cargo build
```

Dependency added under the existing Linux target block in `src-tauri/Cargo.toml`:

```toml
cef = { version = "150.0.0", default-features = false }
```

`default-features = false` drops `sandbox` and `build-util`; neither is needed on Linux.

Build-setup findings worth recording:

- **Linux needs no cmake/ninja.** The `build.rs` constructs a `cmake::Config` for
  `libcef_dll_wrapper` but only calls `.build()` on the Windows and macOS branches. Linux
  links `dylib=cef` directly and copies the CEF runtime files next to the target binary.
  macOS and Windows *do* need cmake + ninja.
- **`CEF_PATH` should be pinned.** With `CEF_PATH` unset the archive is resolved into
  `OUT_DIR`, which `cargo clean` deletes — costing a fresh ~1GB download on every clean
  build. Pointing `CEF_PATH` at a stable cache dir makes it survive.
- The crate ships an `accelerated_osr` feature with a Linux `dmabuf` path
  (`src/osr_texture_import/dmabuf.rs`). Out of scope per the brief, but it exists and is the
  escape hatch if the CPU frame path misses the targets at CP3.

### Message-loop strategy

**Chosen: `do_message_loop_work()` driven by a GTK timer on the main thread, at 60 Hz.**

The three options and why the other two lost:

| Option | Verdict |
| --- | --- |
| `multi_threaded_message_loop` | **Not available.** CEF only supports this on Windows. Dead on arrival for a Linux-target spike. |
| `external_message_pump` + `OnScheduleMessagePumpWork` | Tested after CP1. It did not reduce CPU and, when used as the sole scheduler, did not deliver OSR paints in this Tauri/GTK host. |
| `do_message_loop_work()` on a GTK timer | **Chosen.** Tauri already runs a GTK main loop on Linux; `glib::timeout_add_local` hooks straight into it with no new thread and no new event loop, so neither loop can block the other. |

Cost of the choice, stated honestly: a fixed 16 ms timer bounds worst-case frame latency — a
frame finished just after a pump waits up to a full interval to be delivered, and the pump
burns a little CPU when the page is idle. `external_message_pump` exists precisely to fix
both (CEF tells you *when* it needs time instead of being asked 60×/s). The upgrade is
contained: implement `BrowserProcessHandler::on_schedule_message_pump_work` and replace the
fixed timer with a scheduled one-shot. **Deferred until CP3 measures whether the 16 ms
actually shows up in the frame-latency numbers.**

### Integration points that fought back

**The app already hard-exits, and CEF does not survive that.** `lib.rs` handles
`RunEvent::ExitRequested` by calling `std::process::exit()` outright, with a comment
explaining that normal Tauri teardown deadlocks on Linux (closing sqlite pools blocks on the
main thread, and dropping the ONNX/Supertonic sessions hangs). That is fine for sqlite, but
`process::exit` skips destructors, so any Drop-based CEF teardown would never run and CEF's
child processes would be orphaned as zombies — exactly what CP1 forbids. `cef_osr::shutdown()`
is therefore called explicitly at the top of that exit handler, on the main thread (which is
CEF's UI thread, as `cef_shutdown` requires).

**CEF's subprocess model vs. `main`.** CEF re-executes *the same binary* for its render/GPU/
zygote/utility processes, distinguished by `--type=`. So `cef::execute_process` has to be the
very first statement in `main`, before Tauri, before the startup logger, before any thread is
spawned — CEF forks a zygote on Linux and forking a process that already has threads is UB.
Consequence worth noting for production: every CEF child process is a full copy of the polyui
binary, which links ONNX Runtime, whisper, sqlx and the rest. A dedicated slim helper binary
pointed at by `Settings::browser_subprocess_path` is the fix; sized in CP6.

### Measurements

Measured 2026-07-16 on the target machine, debug build, before creating any CEF browser:

| Measurement | Result |
| --- | --- |
| `cef::initialize` wall time | 579 ms (`CEF initialization` 1784234514382 → `CEF ready` 1784234514961) |
| Idle CPU with CEF initialized and 16 ms GTK pump | 104.8% average over 10 s (`pidstat -p <pid> 1 10`) |
| Idle CPU with CEF initialized and pump disabled | 102.4% average over 10 s |
| Idle CPU with CEF initialization and pump disabled | 2.2% average over 10 s; one 22% startup sample, otherwise 0% |
| CEF helper cleanup after dev process-group exit | 0 remaining matching processes after 1 s |

### Blocker: CEF initialization spins the GTK/Tauri main thread

The first run looked like a fixed-timer problem, but the isolation runs ruled that out:

1. Normal CP1 code (`cef::initialize` + `do_message_loop_work` every 16 ms) held one core.
2. Removing only `start_pump()` still held one core.
3. Removing `cef::initialize` (and the now-invalid pump) returned the same app to idle.

`pidstat -t` attributed the load to the `polyui` main thread, not a CEF helper. No OSR
browser existed in any run, so paint load cannot explain it. Root-cause boundary is now
the CEF initialization/GTK integration, not frame transport and not the timer callback.

This fails CP1's requirement to integrate both event loops without runaway CPU. CP2 is
intentionally unimplemented. Next investigation should reduce this to a minimal cef-rs +
GTK reproducer and compare CEF's external-message-pump path; continuing to OSR first would
bury the integration failure under rendering load.

Normal Tauri `ExitRequested` teardown was not verified: closing the dev process group
removed all helpers, but does not exercise `cef_osr::shutdown()` through the app event.

Follow-up after the owner requested the canvas proof: enabling CEF's external-message-pump
setting and wiring its scheduling callback left idle CPU at 100% and stopped `OnPaint`
delivery. Restoring the fixed 16 ms GTK timer restored paints. A fresh five-second sample
with the working canvas path was exactly 100%, with `pidstat -t` attributing 99.67% to the
main `polyui` thread and effectively zero to its worker threads. On Linux, 100% means one
logical CPU core; the earlier 104.8% is the same saturated-core result plus sampling noise.

## CP2 — First offscreen frame

Implemented after explicit owner override of the CP1 stop:

- One windowless CEF browser loads the viewport URL.
- `OsrRenderHandler::on_paint` receives the CPU BGRA buffer and CEF dirty rectangles.
- The initial implementation crashed at browser creation with
  `CefClient_0_CToCpp called with invalid version -1`. cef-rs requires selecting its
  generated API version with `api_hash(CEF_API_VERSION_LAST, 0)` before any callback-backed
  object crosses into CEF; the upstream OSR example does this but the generated Rust API
  does not enforce it.
- A live `https://example.com/` first frame was received and rendered. The proof was made
  through the CP3 canvas path rather than a standalone PNG dump; the requested PNG artifact
  remains missing.

What does not work: input forwarding is not implemented, and CP1's idle CPU blocker remains.

## CP3 — Frame transport to the frontend

Working prototype:

- `AgentViewportDrawer.tsx` contains no iframe. Its browser surface is a normal DOM
  `<canvas aria-label="CEF browser viewport">`.
- Transport is a Tauri raw IPC `Channel<ArrayBuffer>`, not invoke/base64. Each packet carries
  frame dimensions, the CEF paint timestamp, dirty-rect metadata, and row-packed BGRA bytes.
- First paint and resize send the full surface; steady-state packets contain only CEF's dirty
  rectangles. The frontend validates packets, converts BGRA to RGBA, and calls
  `putImageData` once per dirty rectangle on the next animation frame.
- CSS size is reported to CEF with device pixel ratio; CEF's screen info exposes that scale,
  and the canvas backing store follows the physical CEF frame dimensions.
- ResizeObserver drives `WasResized`; stale-size frames resize the backing store before draw.
- Unmount removes the canvas and sends `CloseBrowser(true)`. One close/remount cycle worked.

Measurements on `https://example.com/`, debug build:

| Measurement | Result |
| --- | --- |
| Live canvas backing store | 701 × 456 pixels |
| Paint timestamp → canvas present | 34.2 ms and 40.5 ms observed first-frame samples |
| 701 × 456 full-frame pixel payload | 1,278,624 bytes, plus 40 bytes packet metadata |
| Dirty-rect steady-state bandwidth | Packet path verified by unit test; sustained bandwidth not yet measured |
| Active/idle app CPU | 100% of one logical core; already consumed before an OSR browser exists |

This proves the iframe replacement and raw frame path, but does not answer the spike's
"feels like a real browser" question. No input exists yet, and CPU already fails the target.

## CP4 — Input forwarding

TBD.

## CP5 — Overlap proof and lifecycle

TBD.

## CP6 — Findings

TBD.
