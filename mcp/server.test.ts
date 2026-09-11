import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * A structural test, for a bug that unit tests could not have caught.
 *
 * `escrowLedger` was correct and thoroughly tested. The defect was that two of the three places
 * asking "how much is in escrow" never went through it: `check_allowance` reported the chain's raw
 * figure and told the user $0.063 was spendable when $0.039 was, and `top_up` sized its deposit
 * against the same raw figure, asking for whatever had not settled a second time — money that
 * escrow only releases as a payment or a delayed withdrawal.
 *
 * No test of the ledger can find that, because the ledger was never wrong. What was wrong was a
 * call site not using it, so what is worth asserting is that exactly one call site exists. The
 * maze does the same thing to keep its router and its published endpoint list in step.
 */

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "server.ts"), "utf8");

/** Ignore the import statement, which names the symbol without calling it. */
const callSites = (haystack: string, fn: string): number =>
  (haystack.match(new RegExp(`\\b${fn}\\(`, "g")) ?? []).length;

test("the chain's escrow figure is read in exactly one place", () => {
  assert.equal(
    callSites(source, "readEscrow"),
    1,
    "A second reader of the raw balance has appeared. Every caller must go through " +
      "spendableEscrow(), or reporting and funding will disagree by whatever has not settled.",
  );
});

test("that one place subtracts what has been claimed and not yet settled", () => {
  const body = source.slice(source.indexOf("async function spendableEscrow("));
  const end = body.indexOf("\n}");
  assert.ok(end > 0, "spendableEscrow() is gone; the single reader it enforces went with it");
  const fn = body.slice(0, end);
  assert.match(fn, /escrow\.spendable\(/, "the one reader stopped consulting the ledger");
  assert.match(fn, /readEscrow\(/, "the one reader stopped consulting the chain");
});

test("the settlement adjustment is not reimplemented anywhere else", () => {
  // A second `escrow.spendable(...)` would be a second answer to the same question, free to drift
  // from the first exactly as the raw reads did. One reader, one adjustment, one answer.
  assert.equal(
    (source.match(/escrow\.spendable\(/g) ?? []).length,
    1,
    "the ledger is consulted in more than one place; fold it back into spendableEscrow()",
  );
});

test("each of the three consumers goes through the reader", () => {
  // Named rather than counted: a count breaks on any honest refactor and proves nothing about
  // which caller was fixed. These are the three questions asked of escrow — what to report, what a
  // purchase still needs, and what a top-up adds to.
  for (const [consumer, marker] of [
    ["check_allowance", "async function escrowLine("],
    ["buy", "async function fundEscrow("],
    ["top_up", "// Added to what is *spendable*, not to what the chain shows."],
  ] as const) {
    const at = source.indexOf(marker);
    assert.ok(at > 0, `${consumer}: could not find ${marker}`);
    const body = source.slice(at, at + 900);
    assert.match(body, /spendableEscrow\(/, `${consumer} does not read escrow through the ledger`);
  }
});

/**
 * The refusal a revoke produces, which is the moment this whole project is built around.
 *
 * "Nobody has granted me anything" and "what I was granted has been taken away" are one condition
 * in the code and two different situations for whoever is reading. The connector answered both with
 * setup instructions — the wrong thing to say at the exact moment somebody has deliberately revoked
 * an agent with their face, because it reads as though the revoke never registered.
 *
 * Structural for the same reason the escrow tests above are: `requireMandate` is not exported, and
 * what went wrong was never a function returning the wrong value. It was one message doing the work
 * of two.
 */
/** The body of `requireMandate`, to the brace that closes it. */
const requireMandateBody = (): string => {
  const at = source.indexOf("async function requireMandate(");
  assert.ok(at > 0, "requireMandate is gone");
  return source.slice(at, source.indexOf("\n}\n", at));
};

test("a withdrawn allowance is not reported as one that never existed", () => {
  const body = requireMandateBody();

  assert.match(body, /rememberedGranter\(/, "a failed lookup forgets what is already known");
  assert.match(body, /withdrawn|revoked/i, "nothing in the refusal says the allowance was taken away");
  assert.match(body, /NO_ALLOWANCE/, "the never-granted case lost its setup instructions");
  assert.match(source, /No allowance yet/, "the never-granted case lost its setup instructions");
});

/**
 * A wallet remembered from before grants carried a pairing code may still hold a live allowance,
 * and nothing ties it to this agent's owner. Telling the person to "grant one" would read as though
 * the allowance they can see in their app did not exist; they are told to scan once instead.
 */
test("a wallet paired before pairing codes is asked to scan once, not told nothing was granted", () => {
  const body = requireMandateBody();
  assert.match(body, /grant\.legacy/, "a legacy wallet is answered the same as no wallet at all");
  assert.match(source, /needs pairing once more/, "the legacy case does not say what to do");
});

/**
 * The remembering must not become the answer.
 *
 * Knowing that one account stopped granting says nothing about whether a *different* account has
 * started. An owner who revokes one allowance and immediately grants another would be told the new
 * one does not exist — so the chain is always searched, and the memory only explains a search that
 * found nothing.
 */
test("what is remembered explains a lookup, and never replaces it", () => {
  const body = requireMandateBody();

  const lookup = body.indexOf("findGrant(");
  const memory = body.indexOf("rememberedGranter(");
  assert.ok(lookup > 0 && memory > lookup,
    "the memory is consulted before the chain, which would hide a fresh grant from another account");
});

/**
 * The history walk, which failed every time it met a live chain.
 *
 * The search for a grant used to start at the plugin's deployment, so an agent nobody had granted
 * yet, and a revoked one, read everything since: measured at 232,000 blocks in twenty-four windowed
 * `eth_getLogs` calls, which exhausted Arc's public rate limit, so a revoke answered with a viem
 * stack trace. A grant now has to carry the pairing code the agent showed, and nothing can carry a
 * code before it was shown, so that block is the floor and the history is never read.
 *
 * Structural because what matters is that the old floor cannot come back; `chain.test.ts` checks the
 * behaviour against a chain.
 */
test("the search for a grant never reads further back than the code it is looking for", () => {
  const chain = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "chain.ts"), "utf8");

  assert.doesNotMatch(chain, /DEPLOY_BLOCK/, "a search floor at the plugin's deployment is back");
  const search = chain.slice(chain.indexOf("async function firstGrantCarrying("));
  assert.match(search, /pairing\.searchedTo === null \? shownAt/,
    "the search does not start where the code was shown");
  assert.match(chain, /const RECENT = LOG_WINDOW \* \d+n/,
    "the stand-in for an unknown floor is not defined in terms of the window it is read in");
});

/**
 * And whatever goes wrong, a person gets a sentence.
 *
 * Arc's endpoint rate-limits. When it did, every tool answered with viem's full dump: calldata, ABI
 * signature, a link to the docs. Reasonable to log, useless to read.
 */
test("an unreachable endpoint is explained, not dumped", () => {
  assert.match(source, /function unreachable\(/, "nothing translates an RPC failure");
  assert.match(source, /rate limit/i, "a rate limit is the failure that actually happens, and is not named");

  const guard = source.slice(source.indexOf("async function requireMandate("), source.indexOf('grant.status === "withdrawn"'));
  assert.match(guard, /try \{/, "the lookup is unguarded, so viem's error reaches the person");
  assert.match(guard, /rememberedGranter\(/,
    "a failure discards what is already known, which is still true and still useful");
});

/**
 * The first thing a new user asks, answered when the chain will not.
 *
 * "What's your payment address?" is step 4 of the path, and when Arc's public endpoint rate-limited
 * it came back as viem's full error dump instead of the QR code, three times out of three in a
 * fresh review. The code never needed the chain: it is the agent's own address. So a failed read
 * must still hand over the code, and say in words what could not be checked.
 *
 * Run for real rather than read as source: the server is started the way an MCP client starts it,
 * pointed at an address where nothing listens, with its key and memory in a scratch directory.
 */
test("the pairing code is shown even when the chain cannot be read", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "arc-mandate-pairing-"));
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) if (value !== undefined) env[name] = value;

  const client = new Client({ name: "pairing-test", version: "0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [
      "--experimental-transform-types", "--disable-warning=ExperimentalWarning",
      join(dirname(fileURLToPath(import.meta.url)), "server.ts"),
    ],
    env: {
      ...env,
      ARC_RPC_URL: "http://127.0.0.1:9",
      ARC_MANDATE_KEY_PATH: join(scratch, "agent.key"),
      ARC_MANDATE_ACCOUNT_PATH: join(scratch, "accounts.json"),
    },
    stderr: "ignore",
  }));

  const ask = async (): Promise<{ readonly body: string; readonly isError: unknown }> => {
    const result = await client.callTool({ name: "get_pairing_address", arguments: {} });
    const body = (result.content as { readonly text?: string }[]).map((part) => part.text ?? "").join("\n");
    return { body, isError: result.isError };
  };
  const LINK = /ethereum:0x[0-9a-fA-F]{40}@\d+\?pairing=([0-9a-f]{32})/;

  try {
    // First ask: no code has been shown yet, so there is no grant to look for and nothing to read.
    const first = await ask();
    assert.notEqual(first.isError, true, "the pairing tool failed instead of answering");
    assert.match(first.body, /0x[0-9a-fA-F]{40}/, "the address is missing");
    // The code the phone scans carries the pairing code the grant has to repeat, and the same code
    // is saved beside the key so it can be scanned again without asking.
    assert.match(first.body, LINK, "the link carries no pairing code");
    assert.ok(existsSync(join(scratch, "pairing-code.png")), "the code was not saved as an image");
    assert.match(first.body, /New allowance/, "the next step is missing");
    assert.doesNotMatch(first.body, /HTTP request failed|Request body|Version: viem/, "viem's dump reached the user");

    // Second ask: now there is a grant to look for, and the chain will not answer. The code is still
    // shown, the same one, and the reply says what could not be checked.
    const second = await ask();
    assert.notEqual(second.isError, true, "the pairing tool failed instead of answering");
    assert.match(second.body, /could not be checked/, "the reply does not say what could not be checked");
    assert.equal(second.body.match(LINK)?.[1], first.body.match(LINK)?.[1], "asking again spoiled the code");
    assert.doesNotMatch(second.body, /HTTP request failed|Request body|Version: viem/, "viem's dump reached the user");
  } finally {
    await client.close();
  }
});
