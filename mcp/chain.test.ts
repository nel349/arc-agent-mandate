import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * What the connector remembers about where it has looked.
 *
 * The bug these exist for is not that searching is slow. It is that a search which cannot finish
 * used to remember nothing, so the next attempt began again and died in the same place — and Arc
 * mints blocks faster than a rate-limited endpoint can read them, so the gap only ever widens. On a
 * public RPC that is not a slow path but a wall, and it arrived exactly as this file's own comment
 * warned it would.
 *
 * The fix records progress after every window. The danger in *that* is the opposite mistake, and
 * the first attempt made it: joining two stretches that do not touch, and so claiming to have read
 * the space between them. A grant sitting in that space would then never be found — silently, and
 * for ever, because nothing goes back to check. These tests are mostly about that.
 */

/**
 * An address no account has ever granted, so every search in this file finds nothing and has to
 * record how far it got, which is what these tests are about.
 *
 * It was the real agent's address, and the tests passed only while nobody had granted it anything
 * recently. Once it was granted again on 09-10, the interrupted search found the grant in its first
 * window, returned it, and recorded the granter instead of a stretch; the test failed on the live
 * chain's state rather than on the code. A never-granted address keeps the precondition true.
 */
const AGENT = "0x000000000000000000000000000000000000dEaD";

/** A state file of its own per test, so none of them can see another's. */
function statePath(): string {
  const path = join(mkdtempSync(join(tmpdir(), "arc-mandate-")), "accounts.json");
  process.env["ARC_MANDATE_ACCOUNT_PATH"] = path;
  return path;
}

const read = (path: string): Record<string, { account?: string; searched?: { low: string; high: string } }> =>
  JSON.parse(readFileSync(path, "utf8")) as never;

test("an interrupted search records the stretch it did read", async () => {
  const path = statePath();
  const { findGrantingAccount } = await import(`./chain.ts?interrupted=${Date.now()}`);

  // One window, then the endpoint gives up — the shape of a rate limit.
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    calls += 1;
    if (calls > 3) throw new Error("rate limit exceeded");
    return original(...args);
  }) as typeof fetch;

  try {
    await findGrantingAccount(AGENT as `0x${string}`).catch(() => null);
  } finally {
    globalThis.fetch = original;
  }

  const kept = read(path)[AGENT.toLowerCase()]?.searched;
  assert.ok(kept !== undefined, "an interrupted search remembered nothing, which is the bug");
  assert.ok(BigInt(kept.high) > BigInt(kept.low), "the recorded stretch is empty");
});

/**
 * The mistake the first fix made, kept as a test because it is invisible in every other way: the
 * file looks reasonable, nothing fails, and a grant in the unread middle is simply never found.
 */
test("a stretch that was never read is never claimed as read", async () => {
  const path = statePath();
  // A small, old, completed search — the state a long-running install is in.
  writeFileSync(path, JSON.stringify({
    [AGENT.toLowerCase()]: { searched: { low: "60625268", high: "60697700" } },
  }));

  const { findGrantingAccount } = await import(`./chain.ts?gap=${Date.now()}`);

  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    calls += 1;
    if (calls > 3) throw new Error("rate limit exceeded");
    return original(...args);
  }) as typeof fetch;

  try {
    await findGrantingAccount(AGENT as `0x${string}`).catch(() => null);
  } finally {
    globalThis.fetch = original;
  }

  const kept = read(path)[AGENT.toLowerCase()]?.searched;
  assert.ok(kept !== undefined);
  // The new blocks are read upwards from the known high, so coverage can only grow by touching it.
  // A run that read one window at the *head* and recorded low=deploy, high=head would be claiming
  // the whole chain — which is what the first version of this did.
  assert.equal(kept.low, "60625268", "the bottom moved without anything being read there");
  assert.ok(
    BigInt(kept.high) < 61_000_000n,
    `claimed to have read up to ${kept.high} after a handful of windows`,
  );
});

/**
 * The older file held one number meaning "everything below here has been read", which is a
 * completed search written down differently. Reading it as *nothing known* would send a long-lived
 * install back to the plugin's deployment and walk the whole chain again — the very failure this
 * work is about, reintroduced by an upgrade.
 *
 * Asserted by where the search *starts*, because that is the only place the difference shows. A
 * test that only checks the file is unchanged passes whether the format is understood or not: with
 * every request failing, nothing is written either way. That version of this test was written
 * first, and survived the mutation that deletes the migration.
 */
test("the older one-number format is read as a search that finished", async () => {
  statePath();
  const path = process.env["ARC_MANDATE_ACCOUNT_PATH"]!;
  writeFileSync(path, JSON.stringify({
    [AGENT.toLowerCase()]: { searchedThrough: "60697700" },
  }));

  const asked: { fromBlock?: string; toBlock?: string }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = (init?.body === undefined ? {} : JSON.parse(String(init.body))) as {
      method?: string;
      params?: { fromBlock?: string; toBlock?: string }[];
    };
    if (body.method === "eth_getLogs") {
      asked.push(body.params?.[0] ?? {});
      throw new Error("rate limit exceeded");
    }
    return original(url, init);
  }) as typeof fetch;

  const { findGrantingAccount } = await import(`./chain.ts?legacy=${Date.now()}`);
  try {
    await findGrantingAccount(AGENT as `0x${string}`).catch(() => null);
  } finally {
    globalThis.fetch = original;
  }

  const first = asked[0];
  assert.ok(first?.fromBlock !== undefined, "no log query was made at all");
  // Understood: the search resumes at the recorded high and walks upward into the new blocks.
  // Not understood: it starts again at the plugin's deployment, far below.
  assert.equal(
    BigInt(first.fromBlock),
    60_697_700n,
    "the search did not resume where the old file said it had reached",
  );
});

/**
 * Telling "never granted" apart from "taken away".
 *
 * Both are the same absence in the code — a lookup that returns nothing — and completely different
 * sentences to a person. The connector used to answer both with "No allowance yet. Open the app and
 * grant one", which is the wrong thing to say at the exact moment somebody has deliberately revoked
 * an agent with their face: it reads as though the revoke never registered.
 *
 * Nothing else can supply this. The chain says only that the key is not a session key now; whether
 * it ever was is precisely what the connector remembered and then threw away.
 */
test("the account that granted an agent is remembered after it stops granting", async () => {
  const path = statePath();
  const GRANTER = "0xc3BB7bc7E375f7ffA34E652F560Dc802F7A76cFa";
  writeFileSync(path, JSON.stringify({ [AGENT.toLowerCase()]: { account: GRANTER } }));

  const { rememberedGranter } = await import(`./chain.ts?remembered=${Date.now()}`);
  assert.equal(rememberedGranter(AGENT as `0x${string}`), GRANTER);
});

test("an agent nobody ever granted anything to remembers nobody", async () => {
  const path = statePath();
  writeFileSync(path, JSON.stringify({}));

  const { rememberedGranter } = await import(`./chain.ts?forgotten=${Date.now()}`);
  assert.equal(rememberedGranter(AGENT as `0x${string}`), null);
});

/** The oldest file format stored a bare address. An upgrade must not lose the distinction. */
test("a grant remembered in the oldest format is still remembered", async () => {
  const path = statePath();
  const GRANTER = "0xc3BB7bc7E375f7ffA34E652F560Dc802F7A76cFa";
  writeFileSync(path, JSON.stringify({ [AGENT.toLowerCase()]: GRANTER }));

  const { rememberedGranter } = await import(`./chain.ts?legacyGranter=${Date.now()}`);
  assert.equal(rememberedGranter(AGENT as `0x${string}`), GRANTER);
});

/** A missing or unreadable state file is an ordinary state, not a failure. */
test("no state file at all is answered rather than thrown at", async () => {
  process.env["ARC_MANDATE_ACCOUNT_PATH"] = join(mkdtempSync(join(tmpdir(), "arc-mandate-")), "absent.json");
  const { rememberedGranter } = await import(`./chain.ts?absent=${Date.now()}`);
  assert.equal(rememberedGranter(AGENT as `0x${string}`), null);
});

/**
 * The first thing a new user asks is "what's your payment address?", and it was the thing that
 * failed. A key made moments ago still walked the chain's whole history looking for a grant nobody
 * could have made yet: about ninety `eth_getLogs` calls, which trips Arc's public rate limit, so the
 * answer was an error instead of the QR code.
 */
test("a key made moments ago reads one window of the chain, not its history", async () => {
  const path = statePath();

  const asked: { fromBlock?: string; toBlock?: string }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = (init?.body === undefined ? {} : JSON.parse(String(init.body))) as {
      method?: string;
      params?: { fromBlock?: string; toBlock?: string }[];
    };
    if (body.method === "eth_getLogs") {
      asked.push(body.params?.[0] ?? {});
      // Enough to tell one read from a walk, without walking the chain if this ever regresses.
      if (asked.length > 3) throw new Error("rate limit exceeded");
    }
    return original(url, init);
  }) as typeof fetch;

  const { findGrantingAccount } = await import(`./chain.ts?newKey=${Date.now()}`);
  let found: unknown;
  try {
    found = await findGrantingAccount(AGENT as `0x${string}`, { keyIsNew: true });
  } finally {
    globalThis.fetch = original;
  }

  assert.equal(found, null);
  assert.equal(asked.length, 1, `a new key made ${asked.length} log reads`);
  const from = BigInt(asked[0]?.fromBlock ?? "0");
  const to = BigInt(asked[0]?.toBlock ?? "0");
  assert.ok(to - from <= 9_999n, "the one read was wider than a window");

  // What it did not need to read is recorded as known, so the next lookup reads only new blocks.
  const kept = read(path)[AGENT.toLowerCase()]?.searched;
  assert.equal(kept?.low, "60625268", "the history below the window was not recorded as known");
  assert.equal(BigInt(kept?.high ?? "0"), to);
});
