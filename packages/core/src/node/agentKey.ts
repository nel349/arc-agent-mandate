import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

/** viem's shape for a private key: hex, and the type says so. */
type PrivateKey = `0x${string}`;

export interface Agent {
  readonly account: PrivateKeyAccount;
  readonly path: string;
  /** True when this run minted the key, which is what tells the caller to expect no mandate yet. */
  readonly created: boolean;
}

/** Node's errors carry a `code`; `unknown` does not, and the difference decides whether we recover. */
const errnoOf = (cause: unknown): string | undefined =>
  typeof cause === "object" && cause !== null && "code" in cause
    ? String((cause as { code: unknown }).code)
    : undefined;

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const isPrivateKey = (value: string): value is PrivateKey => /^0x[0-9a-fA-F]{64}$/.test(value);

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

/** Owner-only. The key is low-authority, not public. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** The agent's key at this path: the one kept there, or a new one made and kept there with only its owner able to read it. */
export function loadOrCreateAgent(keyPath: string): Agent {
  const existing = readKey(keyPath);
  if (existing !== null) {
    tighten(keyPath);
    return { account: privateKeyToAccount(existing), path: keyPath, created: false };
  }

  const key = generatePrivateKey();
  mkdirSync(dirname(keyPath), { recursive: true, mode: DIR_MODE });
  writeFileSync(keyPath, key, { mode: FILE_MODE });
  tighten(keyPath);
  return { account: privateKeyToAccount(key), path: keyPath, created: true };
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
function readKey(keyPath: string): PrivateKey | null {
  let raw: string;
  try {
    raw = readFileSync(keyPath, "utf8").trim();
  } catch (cause) {
    if (errnoOf(cause) === "ENOENT") return null;
    throw new Error(
      `Could not read the agent key at ${keyPath}: ${errnoOf(cause) ?? messageOf(cause)}. ` +
      "Fix the file rather than deleting it — the mandates you have been granted are tied to " +
      "the address it derives.",
      { cause },
    );
  }

  // Shape first, then viem. The guard is what narrows the type; the call is what proves the key
  // actually derives, since a well-shaped 32 bytes can still be out of the curve's range.
  const damaged = new Error(
    `The agent key at ${keyPath} is not a valid private key. It has been damaged rather than ` +
    "lost. Restore it from a backup if you have one; deleting it mints a new identity, and " +
    "every mandate granted to the old address will need granting again.",
  );
  if (!isPrivateKey(raw)) throw damaged;
  try {
    privateKeyToAccount(raw);
  } catch (cause) {
    throw new Error(damaged.message, { cause });
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
function tighten(keyPath: string): void {
  const targets: readonly (readonly [string, number])[] = [
    [dirname(keyPath), DIR_MODE],
    [keyPath, FILE_MODE],
  ];
  for (const [path, mode] of targets) {
    try {
      if ((statSync(path).mode & 0o777) !== mode) chmodSync(path, mode);
    } catch {
      // Best effort: a filesystem that does not carry POSIX modes is not a reason to refuse to
      // run, and the failure to tighten is not itself a leak.
    }
  }
}
