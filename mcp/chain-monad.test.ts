import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address } from "viem";

/**
 * The connector started on Monad, in a process of its own (node runs each test file in one), so the
 * network is read from the environment as the connector reads it. One agent can work on Arc and on
 * Monad from the same key and the same memory file; what it remembers on one must never be taken for
 * the other, since a wallet on Arc is not the agent's wallet on Monad.
 */

process.env["ARC_MANDATE_NETWORK"] = "monadTestnet";
delete process.env["ARC_ACCOUNT"];
// a port nothing listens on: a test that reached for the chain would fail rather than pass by accident
process.env["ARC_MANDATE_RPC_URL"] = "http://127.0.0.1:9";

const AGENT = "0x000000000000000000000000000000000000dEaD" as Address;
const ARC_WALLET = "0xEe1933BbBC8acd7B32caD469D4f22Ca5B19d7918" as Address;
const MONAD_WALLET = "0xc3BB7bc7E375f7ffA34E652F560Dc802F7A76cFa" as Address;
const CODE = "0123456789abcdef0123456789abcdef";

function statePath(contents: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), "arc-mandate-monad-")), "accounts.json");
  process.env["ARC_MANDATE_ACCOUNT_PATH"] = path;
  writeFileSync(path, JSON.stringify(contents));
  return path;
}

const load = (why: string) =>
  import(`./chain.ts?${why}=${Date.now()}-${Math.random()}`) as Promise<typeof import("./chain.ts")>;

test("on Monad the connector reads Monad's node, plugin and chain id, and says MON", async () => {
  statePath({});
  const chain = await load("profile");
  assert.equal(chain.chain.id, 10143);
  assert.equal(chain.chain.nativeCurrency.symbol, "MON");
  assert.equal(chain.RPC, "http://127.0.0.1:9");
  assert.equal(chain.SESSION_KEY_PLUGIN, "0x669Dd1eDb85ABD00f74186d88124614EE81E6670");
});

test("the agent's Arc wallet is not taken for its wallet on Monad", async () => {
  statePath({ [AGENT.toLowerCase()]: { account: ARC_WALLET, accountCode: CODE } });
  const chain = await load("separate");
  assert.equal(chain.memoryKey(AGENT), `monadTestnet:${AGENT.toLowerCase()}`);
  assert.equal(chain.rememberedGranter(AGENT), null);
  assert.deepEqual(await chain.findGrant(AGENT), { status: "unpaired", legacy: null });
});

test("what the agent remembers on Monad is kept under Monad's name, and its Arc memory is left exactly as it was", async () => {
  const arcEntry = { account: ARC_WALLET, accountCode: CODE };
  const path = statePath({ [AGENT.toLowerCase()]: arcEntry });
  const chain = await load("writes");
  chain.rememberIdentity(AGENT, MONAD_WALLET, 42n);
  const file = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(file[AGENT.toLowerCase()], arcEntry);
  assert.deepEqual(file[`monadTestnet:${AGENT.toLowerCase()}`].identities, { [MONAD_WALLET.toLowerCase()]: "42" });
  assert.equal(chain.rememberedIdentity(AGENT, MONAD_WALLET), 42n);
});
