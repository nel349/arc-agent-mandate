import { getAddress, isAddress, isHex, type Address, type TypedDataDomain } from "viem";

/**
 * One statement an app asks an agent to prove it made: its own structure, signed.
 *
 * An agent that works for an app has to be able to say "this is me" at the app's door, not only at
 * the chain. It cannot do that by signing a sentence: an operation is authorised by a plain signature
 * over its hash, so a key that signs whatever text it is handed hands out something replayable as an
 * operation. The mandate refuses that, and the one thing it signs besides an operation is structured
 * data bound to a domain, which is how it pays an x402 seller and consents to its own identity.
 *
 * So an app's door credential is an EIP-712 structure. Such a signature carries the domain's own
 * separator, so it is unusable anywhere but that app, cannot be read as an operation, and is never
 * the wallet's: the plugin validates operations and nothing else, so a session key's signature is
 * only ever the agent's own, and the agent owns nothing.
 *
 * Plain values only, as in a call: no list and no nested structure, so what is signed can be read
 * back and shown to the person whose wallet stands behind it.
 */

/** Said when a statement does not read. */
export type StatementProblem = { readonly problem: string };

const UINT = /^uint(\d*)$/;
const INT = /^int(\d*)$/;
const WHOLE = /^-?\d+$/;
const BYTES_N = /^bytes(\d+)$/;
/** A structure as EIP-712 itself writes it: `Door(string job,uint256 number,address seat)` */
const STATEMENT = /^([A-Za-z_$][\w$]*)\(([^()]*)\)$/;
/** A field, which is one plain type and a name. Anything else, a list or another structure, is refused */
const FIELD = /^(address|string|bool|bytes|bytes\d{1,2}|u?int\d*)\s+([A-Za-z_$][\w$]*)$/;

/** One field's value, as the agent wrote it, made into what the structure holds; or why it cannot be. */
function valueOf(type: string, written: string, field: string): unknown | StatementProblem {
  const which = `${field} (${type})`;
  if (UINT.test(type) || INT.test(type)) {
    if (!WHOLE.test(written) || (UINT.test(type) && written.startsWith("-"))) return { problem: `${which} is a whole number; "${written}" is not.` };
    return BigInt(written);
  }
  if (type === "address") return isAddress(written, { strict: false }) ? getAddress(written) : { problem: `${which} is an address; "${written}" is not.` };
  if (type === "bool") return written === "true" ? true : written === "false" ? false : { problem: `${which} is true or false.` };
  const bytes = BYTES_N.exec(type);
  if (bytes !== null) {
    const length = Number(bytes[1]);
    return isHex(written, { strict: true }) && written.length === 2 + length * 2 ? written : { problem: `${which} is ${length} bytes, written 0x and ${length * 2} hex characters.` };
  }
  if (type === "bytes") return isHex(written, { strict: true }) && written.length % 2 === 0 ? written : { problem: `${which} is bytes, written 0x and hex.` };
  if (type === "string") return written;
  return { problem: `${which}: a statement holds plain values, not lists or structures.` };
}

const isProblem = (value: unknown): value is StatementProblem => typeof value === "object" && value !== null && "problem" in value;

export interface StatementRequest {
  /** the app's name, as its domain carries it */
  readonly app: string;
  readonly version: string;
  /** the app's contract, which its domain names and which the allowance has to reach */
  readonly contract: Address;
  readonly chainId: number;
  /** the structure, written as EIP-712 writes it */
  readonly statement: string;
  /** its fields' values, in the order the structure names them, each written as text */
  readonly values: readonly string[];
}

export interface ToSign {
  readonly domain: TypedDataDomain;
  readonly types: Record<string, readonly { readonly name: string; readonly type: string }[]>;
  readonly primaryType: string;
  readonly message: Record<string, unknown>;
  /** what was signed, said in one line, so the agent can repeat it to the person */
  readonly said: string;
}

/** The typed data a statement asks for, ready to sign, or why it does not read. */
export function statementToSign(request: StatementRequest): ToSign | StatementProblem {
  const written = STATEMENT.exec(request.statement.trim());
  if (written === null) {
    return { problem: `"${request.statement}" is not a structure written as EIP-712 writes it, like Door(string job,uint256 number,address seat).` };
  }
  const [, primaryType = "", inside = ""] = written;
  const parts = inside.split(",").map((part) => part.trim()).filter((part) => part !== "");
  if (parts.length === 0) return { problem: "A statement says something: this one has no fields." };
  const types: { name: string; type: string }[] = [];
  for (const part of parts) {
    const field = FIELD.exec(part);
    if (field === null) return { problem: `"${part}" is not a field: each one is a type and a name, like "string job".` };
    types.push({ type: field[1] ?? "", name: field[2] ?? "" });
  }
  if (request.values.length !== types.length) {
    return { problem: `${primaryType} has ${types.length} field${types.length === 1 ? "" : "s"}; ${request.values.length} were given.` };
  }
  const message: Record<string, unknown> = {};
  for (const [position, field] of types.entries()) {
    const value = valueOf(field.type, request.values[position] ?? "", field.name);
    if (isProblem(value)) return value;
    message[field.name] = value;
  }
  return {
    domain: { name: request.app, version: request.version, chainId: request.chainId, verifyingContract: request.contract },
    types: { [primaryType]: types },
    primaryType,
    message,
    said: `${primaryType} for ${request.app} at ${request.contract}: ${types.map((field, position) => `${field.name} ${request.values[position]}`).join(", ")}`,
  };
}
