import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/**
 * The agent's own key.
 *
 * Generated on first run and kept on the agent's machine. It is never sent anywhere, and the
 * phone never sees it — a mandate is granted to an *address*, so pairing only ever moves a public
 * value in one direction.
 *
 * The key is deliberately low-authority: it can spend only what a mandate allows, only to payees
 * that mandate names, and only until it is revoked. Losing it is a bounded loss, not a wallet.
 * That is the whole point of granting a session key rather than sharing an account.
 */
const KEY_PATH = process.env.ARC_MANDATE_KEY_PATH ?? join(homedir(), ".arc-mandate", "agent.key");

export function loadOrCreateAgent() {
  try {
    const stored = readFileSync(KEY_PATH, "utf8").trim();
    return { account: privateKeyToAccount(stored), path: KEY_PATH, created: false };
  } catch {
    const key = generatePrivateKey();
    mkdirSync(dirname(KEY_PATH), { recursive: true, mode: 0o700 });
    writeFileSync(KEY_PATH, key, { mode: 0o600 });
    return { account: privateKeyToAccount(key), path: KEY_PATH, created: true };
  }
}
