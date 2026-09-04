/**
 * What is 0xf23b1ed7, and what DOES Circle's multisig advertise?
 *
 * The dependency check in Circle's PluginManager is an ERC-165 assertion, not a functional one:
 * it asks whether the plugin at dependencies[i] claims the interface the manifest names. So the
 * question is not "is Circle's plugin compatible" but "does it say so".
 */
import { createPublicClient, http, encodeFunctionData, toFunctionSelector } from "viem";
import { arcTestnet } from "viem/chains";
const c = createPublicClient({ chain: arcTestnet, transport: http() });

const CIRCLE = "0x0000000C984AFf541D6cE86Bb697e68ec57873C8";
const ALCHEMY_MO = "0xcE0000007B008F50d762D155002600004cD6c647";
const SKP = "0x0000003E0000a96de4058e1E02a62FaaeCf23d8d";

const supports = async (addr, id) => {
  try {
    const r = await c.call({ to: addr, data: encodeFunctionData({
      abi: [{ type: "function", name: "supportsInterface", stateMutability: "view",
              inputs: [{ type: "bytes4" }], outputs: [{ type: "bool" }] }],
      functionName: "supportsInterface", args: [id] }) });
    return BigInt(r.data) === 1n;
  } catch { return null; }
};

/** ERC-165 interface id = XOR of the selectors in the interface. */
const xorSelectors = (sigs) => {
  let acc = 0n;
  for (const s of sigs) acc ^= BigInt(toFunctionSelector(s));
  return "0x" + acc.toString(16).padStart(8, "0");
};

// Candidate: Alchemy's IMultiOwnerPlugin surface.
const IMultiOwner = [
  "function updateOwners(address[],address[])",
  "function eip712Domain() view returns (bytes1,string,string,uint256,address,bytes32,uint256[])",
  "function isValidSignature(bytes32,bytes) view returns (bytes4)",
];
console.log("  computed IMultiOwnerPlugin-ish id:", xorSelectors(IMultiOwner), "(target 0xf23b1ed7)");
console.log("  Alchemy MultiOwner claims 0xf23b1ed7:", await supports(ALCHEMY_MO, "0xf23b1ed7"));

// Well-known ERC-6900 v0.7 and standard ids — what does each plugin advertise?
const IDS = {
  "0xf23b1ed7": "SessionKeyPlugin's declared dependency",
  "0x01ffc9a7": "ERC-165",
  "0x1626ba7e": "EIP-1271 isValidSignature",
  "0x6c9d0d1c": "IPlugin (ERC-6900 v0.7)",
  "0x3e5ec2b1": "IPlugin (alt)",
  "0xa5c1e5b9": "IMultisigPlugin?",
  "0x77102c35": "Circle multisig selector, as a probe",
};
console.log("\n  interface                                 Circle   Alchemy");
for (const [id, label] of Object.entries(IDS)) {
  const [a, b] = [await supports(CIRCLE, id), await supports(ALCHEMY_MO, id)];
  console.log(`  ${id} ${label.padEnd(38)} ${String(a).padEnd(8)} ${b}`);
}
