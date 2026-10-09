import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeAbiParameters, encodeEventTopics, parseAbiItem, toFunctionSelector, toHex, type Address, type Hex } from "viem";
import { pairingTag } from "@kuiralabs/mandate-core";

/**
 * The search for a grant, over a long stretch of chain.
 *
 * A code shown and never scanned leaves everything since to be read for a grant carrying it. On Monad
 * that is a hundred blocks a query: three days was 7,380 queries, asked one after another, the best
 * part of an hour in which the connector answered nothing (8 October 2026).
 *
 * The node here is a stand-in on a real port that answers as a node does and keeps how it was asked:
 * which windows, and how many at once. The search is the connector's own, started on Monad as the
 * connector starts, in a process of its own.
 */

const AGENT = "0x000000000000000000000000000000000000dEaD" as Address;
const FIRST = "0xEe1933BbBC8acd7B32caD469D4f22Ca5B19d7918" as Address;
const LATER = "0xc3BB7bc7E375f7ffA34E652F560Dc802F7A76cFa" as Address;
const CODE = "0123456789abcdef0123456789abcdef";
const PLUGIN = "0x669Dd1eDb85ABD00f74186d88124614EE81E6670";
const granted = parseAbiItem("event SessionKeyAdded(address indexed account, address indexed sessionKey, bytes32 indexed tag)");
const IS_SESSION_KEY_OF = toFunctionSelector("isSessionKeyOf(address,address)");
const KEY_TIME_RANGE = toFunctionSelector("getKeyTimeRange(address,address)");

interface Node {
  head: bigint;
  /** grants on the chain: the block each was made in, and who made it */
  grants: { block: bigint; account: Address }[];
  /** how long a query for logs takes to answer */
  answersAfterMs: number;
  windows: { from: bigint; to: bigint }[];
  atOnce: number;
  mostAtOnce: number;
}
const node: Node = { head: 0n, grants: [], answersAfterMs: 0, windows: [], atOnce: 0, mostAtOnce: 0 };
const reset = (to: Partial<Node>): void => { Object.assign(node, { head: 0n, grants: [], answersAfterMs: 0, windows: [], atOnce: 0, mostAtOnce: 0 }, to); };

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
const logOf = (grant: { block: bigint; account: Address }): Record<string, unknown> => ({
  address: PLUGIN, blockNumber: toHex(grant.block), blockHash: `0x${"11".repeat(32)}`, transactionHash: `0x${"22".repeat(32)}`,
  transactionIndex: "0x0", logIndex: "0x0", removed: false, data: "0x",
  topics: encodeEventTopics({ abi: [granted], eventName: "SessionKeyAdded", args: { account: grant.account, sessionKey: AGENT, tag: pairingTag(CODE) } }),
});

async function answer(method: string, params: unknown[]): Promise<unknown> {
  switch (method) {
    case "eth_chainId": return toHex(10143);
    case "eth_blockNumber": return toHex(node.head);
    case "eth_getLogs": {
      const asked = params[0] as { fromBlock: Hex; toBlock: Hex };
      const window = { from: BigInt(asked.fromBlock), to: BigInt(asked.toBlock) };
      node.windows.push(window);
      node.atOnce += 1;
      node.mostAtOnce = Math.max(node.mostAtOnce, node.atOnce);
      if (node.answersAfterMs > 0) await wait(node.answersAfterMs);
      node.atOnce -= 1;
      return node.grants.filter((grant) => grant.block >= window.from && grant.block <= window.to).map(logOf);
    }
    // the plugin, asked whether a wallet grants this agent, and for how long: yes, with no end
    case "eth_call": {
      const data = (params[0] as { data: Hex }).data;
      if (data.startsWith(IS_SESSION_KEY_OF)) return encodeAbiParameters([{ type: "bool" }], [true]);
      if (data.startsWith(KEY_TIME_RANGE)) return encodeAbiParameters([{ type: "uint48" }, { type: "uint48" }], [0, 0]);
      throw new Error(`this stand-in's plugin does not answer ${data.slice(0, 10)}`);
    }
    default: throw new Error(`this stand-in does not answer ${method}`);
  }
}

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  let body = "";
  request.on("data", (piece: Buffer) => { body += piece.toString(); });
  request.on("end", () => {
    const asked = JSON.parse(body) as { id: number; method: string; params: unknown[] };
    answer(asked.method, asked.params).then(
      (result) => response.end(JSON.stringify({ jsonrpc: "2.0", id: asked.id, result })),
      (error: Error) => response.end(JSON.stringify({ jsonrpc: "2.0", id: asked.id, error: { code: -32601, message: error.message } })),
    );
  });
});
await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
after(() => server.close());
const address = server.address();
if (address === null || typeof address === "string") throw new Error("the stand-in node did not start");

process.env["ARC_MANDATE_NETWORK"] = "monadTestnet";
delete process.env["ARC_ACCOUNT"];
process.env["ARC_MANDATE_RPC_URL"] = `http://127.0.0.1:${address.port}`;

function statePath(pairing: { shownAt: string; searchedTo: string | null }): string {
  const path = join(mkdtempSync(join(tmpdir(), "arc-mandate-search-")), "accounts.json");
  process.env["ARC_MANDATE_ACCOUNT_PATH"] = path;
  writeFileSync(path, JSON.stringify({ [`monadTestnet:${AGENT.toLowerCase()}`]: { pairing: { code: CODE, ...pairing } } }));
  return path;
}
const searchedTo = (path: string): string | null =>
  (JSON.parse(readFileSync(path, "utf8")) as Record<string, { pairing: { searchedTo: string | null } }>)[`monadTestnet:${AGENT.toLowerCase()}`]?.pairing.searchedTo ?? null;

const load = (why: string, searchMs?: number) => {
  if (searchMs === undefined) delete process.env["ARC_MANDATE_SEARCH_MS"];
  else process.env["ARC_MANDATE_SEARCH_MS"] = String(searchMs);
  return import(`./chain.ts?${why}=${Date.now()}-${Math.random()}`) as Promise<typeof import("./chain.ts")>;
};

test("a long stretch is read several windows at once, every block of it, and none twice", async () => {
  reset({ head: 5_000n, answersAfterMs: 20 });
  const path = statePath({ shownAt: "0", searchedTo: null });
  const chain = await load("at-once");

  assert.deepEqual(await chain.findGrant(AGENT), { status: "unpaired", legacy: null });

  assert.equal(chain.WINDOWS_AT_ONCE, 10, "on Monad, where a window is a hundred blocks, ten are asked for at once");
  assert.ok(node.mostAtOnce > 1, "the windows were asked for one after another, as they were when it took an hour");
  assert.ok(node.mostAtOnce <= chain.WINDOWS_AT_ONCE, `more than ${chain.WINDOWS_AT_ONCE} were asked for at once, which the node turns away`);
  const read = [...node.windows].sort((a, b) => (a.from < b.from ? -1 : 1));
  assert.equal(read[0]?.from, 0n);
  assert.equal(read[read.length - 1]?.to, 5_000n);
  for (const [i, window] of read.entries()) {
    // Monad's node refuses a query spanning more than a hundred blocks
    assert.ok(window.to - window.from <= 100n, `a window of ${window.to - window.from} blocks was asked for`);
    if (i > 0) assert.equal(window.from, (read[i - 1]?.to ?? -2n) + 1n, "a block was read twice, or not at all");
  }
  assert.equal(searchedTo(path), "5000");
  assert.equal(chain.searchStillToRead(AGENT), null);
});

test("the first grant made is the one found, though a later one is read in the same breath", async () => {
  // both grants fall inside the first batch of windows, the later one in a window answered sooner
  reset({ head: 900n, grants: [{ block: 650n, account: LATER }, { block: 120n, account: FIRST }] });
  statePath({ shownAt: "0", searchedTo: null });
  const chain = await load("first-wins");
  assert.deepEqual(await chain.findGrant(AGENT), { status: "granted", account: FIRST });
});

test("a search that outlasts one question stops, says what is left, and carries on from there at the next", async () => {
  reset({ head: 20_000n, answersAfterMs: 30 });
  const path = statePath({ shownAt: "0", searchedTo: null });
  // one question may spend a tenth of a second searching: far less than this stretch takes
  const chain = await load("out-of-time", 100);

  assert.deepEqual(await chain.findGrant(AGENT), { status: "unpaired", legacy: null });
  const reached = BigInt(searchedTo(path) ?? "-1");
  assert.ok(reached > 0n && reached < 20_000n, `the search read to ${reached}: it either got nowhere or was never stopped`);
  assert.equal(chain.searchStillToRead(AGENT), 20_000n - reached);
  // and it is the agent's own: nothing is said of another agent's search
  assert.equal(chain.searchStillToRead(FIRST), null);

  // the next question starts where this one stopped, and finds the grant further on
  const before = node.windows.length;
  node.grants = [{ block: reached + 150n, account: FIRST }];
  node.answersAfterMs = 0;
  assert.deepEqual(await chain.findGrant(AGENT), { status: "granted", account: FIRST });
  assert.equal(node.windows[before]?.from, reached + 1n);
  assert.equal(chain.searchStillToRead(AGENT), null);
});
