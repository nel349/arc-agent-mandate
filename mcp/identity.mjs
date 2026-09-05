import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
 * The key is deliberately low-authority: it can spend only up to the mandate's limit, and only
 * until that mandate expires or is revoked. Losing it is a bounded loss, not a wallet. That is
 * the whole point of granting a session key rather than sharing an account.
 */
const KEY_PATH = process.env.ARC_MANDATE_KEY_PATH ?? join(homedir(), ".arc-mandate", "agent.key");

/** Owner-only. The key is low-authority, not public. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export function loadOrCreateAgent() {
  const existing = readKey();
  if (existing !== null) {
    tighten();
    return { account: privateKeyToAccount(existing), path: KEY_PATH, created: false };
  }

  const key = generatePrivateKey();
  mkdirSync(dirname(KEY_PATH), { recursive: true, mode: DIR_MODE });
  writeFileSync(KEY_PATH, key, { mode: FILE_MODE });
  tighten();
  return { account: privateKeyToAccount(key), path: KEY_PATH, created: true };
}

/**
 * The stored key, or `null` only when there genuinely isn't one.
 *
 * The distinction is the whole function. A blanket `catch` here used to treat *every* failure as
 * "no key yet" and generate a replacement — so a truncated file, a bad copy or a momentary
 * permission problem silently minted a new identity and overwrote the old one. The agent's
 * address would change, every mandate granted to the previous address would point at a key that
 * no longer exists, and nothing anywhere would say why the agent had stopped being able to spend.
 *
 * A missing file is the one recoverable case. Everything else stops, loudly, with the path.
 */
function readKey() {
  let raw;
  try {
    raw = readFileSync(KEY_PATH, "utf8").trim();
  } catch (cause) {
    if (cause.code === "ENOENT") return null;
    throw new Error(
      `Could not read the agent key at ${KEY_PATH}: ${cause.code ?? cause.message}. ` +
      "Fix the file rather than deleting it — the mandates you have been granted are tied to " +
      "the address it derives.",
      { cause },
    );
  }

  try {
    privateKeyToAccount(raw);
  } catch (cause) {
    throw new Error(
      `The agent key at ${KEY_PATH} is not a valid private key. It has been damaged rather than ` +
      "lost. Restore it from a backup if you have one; deleting it mints a new identity, and " +
      "every mandate granted to the old address will need granting again.",
      { cause },
    );
  }
  return raw;
}

/**
 * Permissions, applied rather than requested.
 *
 * `mkdirSync` and `writeFileSync` apply `mode` **only when they create** — and both are also
 * subject to the process umask. A `~/.arc-mandate` that already existed at 0755, or a key file
 * restored from a backup that carried its old mode, keeps whatever it had, leaving a private key
 * somewhere other local accounts can reach. Asking is not the same as ensuring.
 */
function tighten() {
  for (const [path, mode] of [[dirname(KEY_PATH), DIR_MODE], [KEY_PATH, FILE_MODE]]) {
    try {
      if ((statSync(path).mode & 0o777) !== mode) chmodSync(path, mode);
    } catch {
      // Best effort: a filesystem that does not carry POSIX modes is not a reason to refuse to
      // run, and the failure to tighten is not itself a leak.
    }
  }
}
