import { test } from "node:test";
import assert from "node:assert/strict";
import { fingerprintLines, shortFingerprint } from "./fingerprint.ts";

const AGENT = "0x806dC09Fc68509E77B5909f88f2A934b3D2852E5";

test("an address prints as a key's fingerprint: ten groups of four, five to a line, nothing left out", () => {
  assert.deepEqual(fingerprintLines(AGENT), ["806D C09F C685 09E7 7B59", "09F8 8F2A 934B 3D28 52E5"]);
  assert.equal(fingerprintLines(AGENT).join("").replace(/ /g, ""), AGENT.slice(2).toUpperCase());
});

test("on one line it keeps the two groups at the start and the one at the end", () => {
  assert.equal(shortFingerprint(AGENT), "806D C09F … 52E5");
});
