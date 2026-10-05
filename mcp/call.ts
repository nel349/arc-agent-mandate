import { exactFunction } from "@kuiralabs/mandate-core";
import { encodeFunctionData, getAddress, isAddress, isHex, parseAbiItem, type Hex } from "viem";

/**
 * One contract call an agent asks for, made into the data the wallet sends.
 *
 * The connector stays general: it calls whatever function the agent names, and the allowance decides
 * whether it may. The grant lists each contract with only the functions its app's code named, so a
 * call to anything else is refused by the chain before it runs. What is checked here is only that the
 * call reads, so a mistake is said in words rather than met as a revert.
 *
 * Plain values only: numbers, addresses, booleans, bytes and strings. A list or a tuple is refused
 * rather than guessed at, since none of the functions an app has named so far takes one.
 */

/** Said when a call does not read. */
export type CallProblem = { readonly problem: string };

const UINT = /^uint(\d*)$/;
const INT = /^int(\d*)$/;
const WHOLE = /^-?\d+$/;
const BYTES_N = /^bytes(\d+)$/;

/** One argument, as the agent wrote it, made into what the function takes; or why it cannot be. */
function argumentOf(type: string, written: string, position: number): unknown | CallProblem {
  const which = `Argument ${position + 1} (${type})`;
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
  return { problem: `${which}: only plain values can be passed, not lists or tuples.` };
}

const isProblem = (value: unknown): value is CallProblem => typeof value === "object" && value !== null && "problem" in value;

/** The data for one call to `signature` with `args`, or why it does not read. */
export function encodeCall(signature: string, args: readonly string[]): { readonly data: Hex; readonly name: string } | CallProblem {
  const exact = exactFunction(signature);
  if (exact === null) return { problem: `"${signature}" is not a function written exactly, like takeSeat(uint256,uint8,address).` };
  const item = parseAbiItem(`function ${exact}`);
  if (item.type !== "function") return { problem: `"${signature}" is not a function.` };
  if (args.length !== item.inputs.length) {
    return { problem: `${item.name} takes ${item.inputs.length} argument${item.inputs.length === 1 ? "" : "s"}; ${args.length} were given.` };
  }
  const values: unknown[] = [];
  for (const [position, input] of item.inputs.entries()) {
    const value = argumentOf(input.type, args[position] ?? "", position);
    if (isProblem(value)) return value;
    values.push(value);
  }
  return { data: encodeFunctionData({ abi: [item], functionName: item.name, args: values }), name: item.name };
}
