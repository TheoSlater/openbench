// Exercises the helper's multi-browser and history behaviour.
//
// Two browsers must coexist under distinct ids (one per viewport tab), and
// back/forward must walk Chromium's own session history rather than a list the
// app keeps. Prints PASS/FAIL per assertion and exits non-zero on any failure.

import { spawn } from "node:child_process";
import { readMessages } from "./viewport-wire.mjs";

const helper = spawn("src-tauri/target/debug/polyui-viewport", [], {
  stdio: ["pipe", "pipe", "inherit"],
});
const send = (obj) => helper.stdin.write(`${JSON.stringify(obj)}\n`);

const state = new Map(); // id -> { frames, addresses[], nav }
const errors = [];
readMessages(helper.stdout, (tag, id, payload) => {
  if (!state.has(id)) state.set(id, { frames: 0, addresses: [], nav: null });
  const entry = state.get(id);
  if (tag === "frame") entry.frames += 1;
  else if (tag === "address") entry.addresses.push(payload.toString("utf8"));
  else if (tag === "navState") entry.nav = JSON.parse(payload.toString("utf8"));
  else if (tag === "error") errors.push(`id=${id} ${payload.toString("utf8")}`);
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (predicate, ms = 20000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await wait(200);
  }
  return false;
};
const idle = (id) => state.get(id)?.nav?.isLoading === false;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const geom = { width: 600, height: 400, scaleFactor: 1 };

// Two browsers, opened together, must both paint. The in-process version could
// only ever hold one: opening the second silently destroyed the first.
send({ cmd: "open", id: 1, url: "https://example.com", ...geom });
send({ cmd: "open", id: 2, url: "https://example.org", ...geom });
await until(() => idle(1) && idle(2));

check("two browsers coexist", state.get(1)?.frames > 0 && state.get(2)?.frames > 0,
  `id1=${state.get(1)?.frames ?? 0} frames, id2=${state.get(2)?.frames ?? 0} frames`);
check("each browser reports its own address",
  state.get(1)?.addresses[0]?.includes("example.com") &&
    state.get(2)?.addresses[0]?.includes("example.org"),
  `${state.get(1)?.addresses[0]} | ${state.get(2)?.addresses[0]}`);
check("no back history on a fresh browser", state.get(1)?.nav?.canGoBack === false);

// Navigate browser 1 in place; Chromium should now offer a back entry.
send({ cmd: "navigate", id: 1, url: "https://example.org" });
await until(() => state.get(1)?.addresses.some((a) => a.includes("example.org")));
await until(() => idle(1) && state.get(1)?.nav?.canGoBack === true);
check("navigating in place builds real history", state.get(1)?.nav?.canGoBack === true);
check("browser 2 unaffected by browser 1 navigating",
  state.get(2)?.addresses.every((a) => a.includes("example.org")) &&
    state.get(2)?.nav?.canGoBack === false);

// Back must return to the first page and offer a forward entry.
const beforeBack = state.get(1).addresses.length;
send({ cmd: "back", id: 1 });
await until(() => state.get(1).addresses.length > beforeBack);
await until(() => idle(1));
check("back returns to the previous page",
  state.get(1).addresses.at(-1)?.includes("example.com"),
  state.get(1).addresses.at(-1));
check("forward becomes available after going back",
  state.get(1)?.nav?.canGoForward === true);

// Closing one browser must leave the other alive and painting.
const framesBefore2 = state.get(2).frames;
send({ cmd: "close", id: 1 });
await wait(1000);
send({ cmd: "reload", id: 2 });
await until(() => state.get(2).frames > framesBefore2);
check("closing one browser leaves the other running",
  state.get(2).frames > framesBefore2);

// A command for a browser that does not exist should report, not crash.
send({ cmd: "navigate", id: 99, url: "https://example.com" });
await until(() => errors.some((e) => e.includes("id=99")), 5000);
check("unknown browser id reports an error instead of crashing",
  errors.some((e) => e.includes("id=99")), errors.find((e) => e.includes("id=99")));

const unexpected = errors.filter((e) => !e.includes("id=99"));
check("no unexpected errors", unexpected.length === 0, unexpected.join("; "));

send({ cmd: "shutdown" });
helper.stdin.end();
await wait(1500);
helper.kill();

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
