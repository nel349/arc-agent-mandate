import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { loadOrCreateAgent } from "./agentKey.ts";

/**
 * The agent's key is its address, and every mandate a person grants is made to that address. So the
 * file is kept private, and a key that cannot be read is never quietly replaced: a new key would leave
 * every grant pointing at an address nothing can sign for, with nothing saying why.
 */

const aPlace = (): string => join(mkdtempSync(join(tmpdir(), "mandate-key-")), "agent", "agent.key");
const modeOf = (path: string): number => statSync(path).mode & 0o777;

test("the first run makes a key only its owner can read, in a folder only its owner can enter", () => {
  const path = aPlace();
  const agent = loadOrCreateAgent(path);
  assert.equal(agent.created, true);
  assert.equal(agent.path, path);
  assert.equal(modeOf(path), 0o600);
  assert.equal(modeOf(join(path, "..")), 0o700);
  assert.equal(privateKeyToAccount(readFileSync(path, "utf8").trim() as `0x${string}`).address, agent.account.address);
});

test("every later run is the same agent, at the same address, with nothing made anew", () => {
  const path = aPlace();
  const first = loadOrCreateAgent(path);
  const again = loadOrCreateAgent(path);
  assert.equal(again.created, false);
  assert.equal(again.account.address, first.account.address);
});

test("a key restored with loose permissions is made private again when it is read", () => {
  const path = aPlace();
  loadOrCreateAgent(path);
  chmodSync(path, 0o644);
  chmodSync(join(path, ".."), 0o755);
  loadOrCreateAgent(path);
  assert.equal(modeOf(path), 0o600);
  assert.equal(modeOf(join(path, "..")), 0o700);
});

test("a damaged key is refused, with its path, and left as it was rather than replaced", () => {
  for (const damaged of ["not a key", "0x1234", `0x${"ff".repeat(32)}`]) {
    const path = aPlace();
    loadOrCreateAgent(path);
    writeFileSync(path, damaged);
    assert.throws(() => loadOrCreateAgent(path), (error: unknown) => error instanceof Error && error.message.includes(path) && /not a valid private key/.test(error.message));
    assert.equal(readFileSync(path, "utf8"), damaged, "the damaged file was overwritten");
  }
});

test("a key that cannot be read is refused rather than taken for missing, and nothing is written over it", () => {
  const path = aPlace();
  const agent = loadOrCreateAgent(path);
  chmodSync(path, 0o000);
  try {
    assert.throws(() => loadOrCreateAgent(path), /Could not read the agent key/);
  } finally {
    chmodSync(path, 0o600);
  }
  assert.equal(loadOrCreateAgent(path).account.address, agent.account.address);
});
