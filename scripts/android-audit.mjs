#!/usr/bin/env node
/**
 * What the app actually looks like on an Android device, checked rather than eyeballed.
 *
 * Three faults on this app were "fixed" more than once without being fixed, because a screenshot is
 * slow to read and a claim is quick to make. This drives the device instead: it captures each screen
 * as a picture *and* as a hierarchy, and then asserts the one thing a picture cannot be trusted for —
 * that nothing a person needs is underneath a bar the system draws on top.
 *
 * Usage:
 *   node scripts/android-audit.mjs              # audit whatever is on screen now
 *   node scripts/android-audit.mjs --walk       # walk the tabs and audit each
 *   node scripts/android-audit.mjs --out before # write captures under .android-audit/before
 *
 * Exits non-zero when something is cut off, so it can gate a change rather than merely describe one.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const adb = (...args) => execFileSync("adb", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/**
 * The navigation bar, in pixels.
 *
 * Android states it in density-independent pixels and hands the app the same figure through the safe
 * area, so this is the one number both sides agree on: measured at 48 on the device this was written
 * against, which is the Material default. Multiplied by the display's own density rather than assumed.
 */
const NAV_BAR_DP = 48;

function display() {
  const size = /(\d+)x(\d+)/.exec(adb("shell", "wm", "size"));
  const density = /(\d+)/.exec(adb("shell", "wm", "density"));
  const scale = Number(density[1]) / 160;
  return { width: Number(size[1]), height: Number(size[2]), scale, navBar: Math.round(NAV_BAR_DP * scale) };
}

/** Every node carrying something a person reads or touches, with where it sits. */
function hierarchy() {
  adb("shell", "uiautomator", "dump", "/sdcard/audit.xml");
  const xml = adb("shell", "cat", "/sdcard/audit.xml");
  adb("shell", "rm", "/sdcard/audit.xml");
  const nodes = [];
  for (const match of xml.matchAll(/<node[^>]*>/g)) {
    const tag = match[0];
    const text = /text="([^"]*)"/.exec(tag)?.[1] ?? "";
    const desc = /content-desc="([^"]*)"/.exec(tag)?.[1] ?? "";
    const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(tag);
    const label = (text || desc).trim();
    if (!label || !bounds) continue;
    const [, x1, y1, x2, y2] = bounds.map(Number);
    nodes.push({ label, x1, y1, x2, y2, clickable: /clickable="true"/.test(tag) });
  }
  return nodes;
}

/**
 * Anything reaching into, or pressed flat against, the strip the system owns.
 *
 * The obvious test — does a node cross the floor — passed every run while the tab bar sat jammed
 * against the navigation bar with no gap at all, because it ends *exactly* on the floor rather than
 * past it. A check that reports "all clear" for the thing being complained about is worse than none,
 * so touching the floor counts too: on a screen laid out edge to edge, chrome flush against the
 * system bar is the fault, not the boundary case.
 */
const TOUCHING = 2;

function cutOff(nodes, screen) {
  const floor = screen.height - screen.navBar;
  return nodes
    .filter((n) => n.y2 >= floor - TOUCHING)
    .map((n) => ({ ...n, over: n.y2 - floor, flush: n.y2 <= floor + TOUCHING }));
}

function capture(dir, name) {
  mkdirSync(dir, { recursive: true });
  // Captured to a file on the device and pulled, never through `exec-out`: this device has more than
  // one display, and adb prefixes the PNG bytes with a warning about that, corrupting the image.
  adb("shell", "screencap", "-p", "/sdcard/audit.png");
  adb("pull", "/sdcard/audit.png", join(dir, `${name}.png`));
  adb("shell", "rm", "/sdcard/audit.png");
  return join(dir, `${name}.png`);
}

function audit(dir, name) {
  const screen = display();
  const nodes = hierarchy();
  const shot = capture(dir, name);
  const bad = cutOff(nodes, screen);
  writeFileSync(join(dir, `${name}.json`), JSON.stringify({ screen, nodes }, null, 2));

  console.log(`\n=== ${name} ===`);
  console.log(`screen ${screen.width}x${screen.height} @${screen.scale}x · nav bar ${screen.navBar}px `
    + `· safe below y=${screen.height - screen.navBar}`);
  console.log(`captured ${shot}`);
  if (bad.length === 0) {
    console.log("nothing under the system bar");
    return 0;
  }
  console.log(`CUT OFF — ${bad.length} node(s) at or past the system bar:`);
  for (const n of bad) {
    const how = n.flush ? "flush with" : `${n.over}px into`;
    console.log(`  ${how.padStart(12)}  [${n.x1},${n.y1}][${n.x2},${n.y2}]  ${n.label.slice(0, 52)}`);
  }
  return bad.length;
}

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const dir = join(".android-audit", outIndex === -1 ? "now" : args[outIndex + 1]);

let problems = audit(dir, "current");

if (args.includes("--walk")) {
  // Tabs are found by their label rather than by remembered coordinates: this device folds, and
  // coordinates taken before a fold are wrong after one — which cost two wasted rounds.
  const screen = display();
  for (const tab of ["Rewards", "Allowances"]) {
    const node = hierarchy().find((n) => n.label === tab && n.y2 > screen.height * 0.7);
    // A walk that cannot reach a screen has audited nothing, and reporting that as "all clear" is
    // the exact failure this harness exists to stop. It counts as a problem.
    if (!node) {
      console.log(`\nCANNOT REACH the ${tab} tab — nothing was audited for it`);
      problems += 1;
      continue;
    }
    adb("shell", "input", "tap", String((node.x1 + node.x2) >> 1), String((node.y1 + node.y2) >> 1));
    adb("shell", "sleep", "4");
    problems += audit(dir, tab.toLowerCase());
  }
}

console.log(problems === 0 ? "\nAll clear." : `\n${problems} cut-off node(s).`);
process.exit(problems === 0 ? 0 : 1);
