import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { PRODUCT_NAME, WORDMARK } from "./product.ts";

const ROOT = decodeURIComponent(new URL("../..", import.meta.url).pathname);

/**
 * Where the product's own words are written: the app, the connector and what they share, each with
 * the page that is published with it, the scripts, the brand's files, and what the repository says
 * about itself.
 */
const WRITTEN_IN = [
  "app", "src", "mcp", "packages/core", "scripts", "brand", "docs", "app.json", "README.md",
];
/** Built output and other people's code say what they say. */
const NOT_OURS = new Set(["node_modules", "dist", "dist-web", ".expo", "lib"]);
/** Anything a person or an agent reads as words. A picture's words are checked by eye, when it is redrawn. */
const SOURCE = /\.(ts|tsx|cjs|mjs|json|md|html|svg)$/;

/**
 * The names it used to have, each of which was in the product at once.
 *
 * Two files are allowed to spell them: the two that say what the name used to be, which is the
 * only way to say it.
 */
const OLD_NAMES = /arc agent mandate|agent mandate|arc mandate/i;

/**
 * The text as it would be read: a sentence written across several strings joined by `+`, as the
 * connector writes its instructions, put back together, and every run of space made one. An old
 * name split over two lines of source is still an old name on the agent's screen.
 */
const asRead = (source: string): string =>
  source.replace(/["'`]\s*\+\s*["'`]/g, "").replace(/\s+/g, " ");
const MAY_SAY_SO = new Set(["packages/core/src/product.ts", "src/ui/product.test.ts"]);

function filesUnder(path: string): string[] {
  const full = join(ROOT, path);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    if (NOT_OURS.has(entry.name)) return [];
    const child = join(path, entry.name);
    return entry.isDirectory() ? filesUnder(child) : SOURCE.test(entry.name) ? [join(ROOT, child)] : [];
  });
}

test("the name is one word with no chain in it, and the mark is that word in lower case", () => {
  assert.equal(PRODUCT_NAME, "Mandate");
  assert.equal(WORDMARK, "mandate");
});

/**
 * It was "Arc Agent Mandate" in the app's config, "Agent Mandate" in what the connector tells an
 * agent to say, and "Arc Mandate" in the wallet's notices. A name typed wherever it is needed
 * drifts; this is what stops the next one being typed.
 */
test("no file spells one of the product's old names", () => {
  const files = WRITTEN_IN.flatMap(filesUnder);
  assert.ok(files.length > 100, "the search found too little to mean anything");
  const still = files
    .filter((file) => !MAY_SAY_SO.has(relative(ROOT, file)))
    .filter((file) => OLD_NAMES.test(asRead(readFileSync(file, "utf8"))))
    .map((file) => relative(ROOT, file));
  assert.deepEqual(still, []);
});

test("an old name is found however it is written", () => {
  assert.ok(OLD_NAMES.test(asRead('"open the Agent " +\n    "Mandate wallet"')), "split across two strings");
  assert.ok(OLD_NAMES.test(asRead("the agent\n  mandate app")), "lower case, across a line");
  assert.ok(OLD_NAMES.test(asRead("Arc  Mandate")), "with two spaces");
  // The connector's package is named with a hyphen, and is not the product's name.
  assert.equal(OLD_NAMES.test(asRead("@kuiralabs/arc-mandate")), false);
});

test("the app's config names it as the code does", () => {
  const config = JSON.parse(readFileSync(join(ROOT, "app.json"), "utf8")) as { expo: { name: string } };
  assert.equal(config.expo.name, PRODUCT_NAME);
});
