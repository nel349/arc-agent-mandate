#!/usr/bin/env node
/**
 * Turn a device-run log line into a test fixture.
 *
 *   node scripts/save-vector.mjs 'ARC_PASSKEY_VECTOR {"platform":"ios",…}'
 *   … | node scripts/save-vector.mjs          # or pipe the Metro output straight in
 *
 * Registration prints the line (see `src/passkey/vector-capture.ts`); this writes it to
 * `src/passkey/vectors/`, where `cose.device.test.ts` finds it without any further wiring.
 */
import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TAG = "ARC_PASSKEY_VECTOR";
const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "passkey", "vectors");

const read = async () => {
  const arg = process.argv.slice(2).join(" ").trim();
  if (arg) return arg;
  process.stdin.setEncoding("utf8");
  let all = "";
  for await (const chunk of process.stdin) all += chunk;
  return all;
};

const text = await read();
const lines = text.split("\n").filter((l) => l.includes(TAG));
if (lines.length === 0) {
  console.error(
    `No ${TAG} line found.\n\n` +
    "Run the app on a device with `npx expo run:ios --device`, register a passkey in the\n" +
    "developer harness, and the line appears in the terminal running Metro. Paste it here, or\n" +
    "pipe that terminal's output through this script.",
  );
  process.exit(1);
}

mkdirSync(DIR, { recursive: true });
for (const line of lines) {
  const json = line.slice(line.indexOf(TAG) + TAG.length).trim();
  let vector;
  try {
    vector = JSON.parse(json);
  } catch {
    console.error(`Could not parse the payload after ${TAG}:\n${json}`);
    process.exit(1);
  }
  for (const field of ["platform", "osVersion", "attestationObject"]) {
    if (typeof vector[field] !== "string" || vector[field].length === 0) {
      console.error(`Vector is missing "${field}".`);
      process.exit(1);
    }
  }
  // Named for what distinguishes one vector from another. A second capture on the same OS
  // overwrites rather than accumulating near-duplicates.
  const name = `${vector.platform}-${vector.osVersion}.json`.replace(/[^\w.-]/g, "_");
  writeFileSync(join(DIR, name), `${JSON.stringify(vector, null, 2)}\n`);
  console.log(`saved src/passkey/vectors/${name}`);
}
console.log(`\n${readdirSync(DIR).filter((f) => f.endsWith(".json")).length} vector(s) on file. Run: npm test`);
