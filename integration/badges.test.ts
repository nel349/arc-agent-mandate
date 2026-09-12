import { test } from "node:test";
import assert from "node:assert/strict";
import type { Address } from "viem";
import { badgesOf } from "../src/arc/badges.ts";
import { readBadgeMetadata } from "../src/ui/badge-metadata.ts";
import { readingLive } from "./arc-endpoint.ts";

/**
 * The badge, against the live chain and the live maze.
 *
 * A fork cannot answer this: the cohort was minted on Arc, and the picture comes from the maze's own
 * address, which the token names. So this reads both, and pins what they say today — that badge one
 * is held by the wallet that earned it on 09-10, that its `tokenURI` is the maze's address for it,
 * and that the address answers with a picture the phone can draw.
 *
 * Read-only, and it spends nothing.
 */

/** The wallet that solved the maze on 09-10, before the cohort was opened afresh. */
const EARNED_IT = "0xc3BB7bc7E375f7ffA34E652F560Dc802F7A76cFa" as Address;
/**
 * An address nobody plays from, so it can never stop being empty.
 *
 * This used to be the wallet these tests' agent spends from, which was true until that wallet earned
 * badge two on 09-11 — and then this failed, correctly reporting a badge that should have been
 * celebrated rather than a fault. A fixture for "holds nothing" must be something that cannot come to
 * hold something; a wallet we actively use is the opposite of that.
 */
const NOBODY = "0x0000000000000000000000000000000000000001" as Address;

test("the cohort's first badge is held by the wallet that earned it, and names the maze's address", async () => {
  const held = await readingLive("the cohort's badges", () => badgesOf(EARNED_IT));
  assert.deepEqual(held, [{ number: 1, uri: "https://arc-maze.vercel.app/badge/1" }]);
});

test("a wallet that has earned nothing costs one read and answers nothing", async () => {
  assert.deepEqual(await readingLive("a wallet's badges", () => badgesOf(NOBODY)), []);
});

test("the address a badge names answers with the picture it carries", async () => {
  const response = await fetch("https://arc-maze.vercel.app/badge/1", { headers: { accept: "application/json" } });
  assert.equal(response.ok, true, "the maze did not answer for badge 1");
  const art = readBadgeMetadata(await response.json());
  assert.equal(art?.name, "Cohort Zero #1");
  assert.match(String(art?.svg), /^<svg /, "the badge carried no picture the phone can draw");
});
