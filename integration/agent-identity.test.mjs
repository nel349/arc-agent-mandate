import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The agent's identity must not change by accident.
 *
 * A mandate is granted to an *address*. If the agent's key is replaced, every mandate the person
 * granted points at a key that no longer exists — the agent silently loses the ability to spend,
 * and the only visible symptom is that nothing works. The original code treated any read failure
 * as "no key yet" and generated a replacement, so a truncated file was enough to trigger it.
 *
 * Each case loads the module afresh: the key path is read once, at import.
 */
const withKeyPath = async (path) => {
  process.env.ARC_MANDATE_KEY_PATH = path;
  const mod = await import(`../mcp/identity.mjs?case=${encodeURIComponent(path)}`);
  return mod.loadOrCreateAgent;
};

const scratch = () => mkdtempSync(join(tmpdir(), "arc-identity-"));

test("a first run creates a key, and a second run returns the same identity", async () => {
  const path = join(scratch(), "agent.key");
  const first = (await withKeyPath(path))();
  assert.equal(first.created, true);

  const again = (await withKeyPath(path))();
  assert.equal(again.created, false);
  assert.equal(again.account.address, first.account.address);
});

test("a damaged key stops the agent rather than silently becoming a new one", async () => {
  const path = join(scratch(), "agent.key");
  const before = (await withKeyPath(path))().account.address;

  writeFileSync(path, "0xdeadbeef"); // a truncated write, a bad copy, a half-finished restore
  const load = await withKeyPath(path);
  assert.throws(load, /not a valid private key/,
    "a damaged key was replaced instead of reported — every existing mandate would be orphaned");

  // And the damaged file is still there to be restored from, not overwritten.
  assert.notEqual(before, null);
});

test("an unreadable key is reported, not replaced", async () => {
  const dir = scratch();
  const path = join(dir, "agent.key");
  (await withKeyPath(path))();
  chmodSync(path, 0o000);
  const load = await withKeyPath(path);
  try {
    assert.throws(load, /Could not read the agent key/);
  } finally {
    chmodSync(path, 0o600);
  }
});

test("a directory that already exists is tightened, not trusted", async () => {
  const dir = join(scratch(), ".arc-mandate");
  mkdirSync(dir, { mode: 0o755 });
  const path = join(dir, "agent.key");
  (await withKeyPath(path))();

  assert.equal(statSync(dir).mode & 0o777, 0o700, "the key directory is reachable by other users");
  assert.equal(statSync(path).mode & 0o777, 0o600, "the key file is readable by other users");
});
