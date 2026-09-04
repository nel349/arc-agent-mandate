/**
 * MANDATE_DESIGN.md step 1 — a pure read. No transaction, nothing spent.
 *
 * Circle's PluginManager reverts with InvalidPluginDependency when a manifest's declared
 * dependencies are not satisfied by plugins already on the account. Alchemy's SessionKeyPlugin
 * was built against Alchemy's MultiOwnerPlugin; Circle's account carries
 * WeightedWebauthnMultisigPlugin. This asks whether that substitution is acceptable.
 *
 * The manifest head is decoded by hand rather than through a full ABI signature: only the two
 * leading `bytes4[]` fields matter, and hand-decoding cannot be wrong about a struct layout
 * further down that we never read.
 */
import { createPublicClient, http, toFunctionSelector, encodeFunctionData } from "viem";
import { arcTestnet } from "viem/chains";

const c = createPublicClient({ chain: arcTestnet, transport: http() });
const SESSION_KEY_PLUGIN = "0x0000003E0000a96de4058e1E02a62FaaeCf23d8d";
const CIRCLE_MULTISIG    = "0x0000000C984AFf541D6cE86Bb697e68ec57873C8";
const ALCHEMY_MULTIOWNER = "0xcE0000007B008F50d762D155002600004cD6c647";

const { data } = await c.call({
  to: SESSION_KEY_PLUGIN,
  data: toFunctionSelector("function pluginManifest() view returns (bytes)"),
});

const hex = data.slice(2);
const word = (i) => hex.slice(i * 64, i * 64 + 64);
const num = (i) => Number(BigInt("0x" + word(i)));

// A dynamic struct return: word 0 is the offset to the struct; the struct's own head follows.
const structStart = num(0) / 32;
/** Reads a bytes4[] whose offset sits at head slot `slot`, relative to the struct start. */
const readBytes4Array = (slot) => {
  const at = structStart + num(structStart + slot) / 32;
  const length = num(at);
  return Array.from({ length }, (_, k) => "0x" + word(at + 1 + k).slice(0, 8));
};

const interfaceIds = readBytes4Array(0);
const dependencyInterfaceIds = readBytes4Array(1);

console.log("SessionKeyPlugin v1.0.1 manifest");
console.log("  interfaceIds           :", interfaceIds.join(", ") || "(none)");
console.log("  dependencyInterfaceIds :", dependencyInterfaceIds.join(", ") || "(none)");

if (dependencyInterfaceIds.length === 0) {
  console.log("\n  => NO DEPENDENCIES. InvalidPluginDependency cannot fire. Risk removed.");
} else {
  console.log("\n  is each dependency advertised via ERC-165?");
  const supports = async (plugin, id) => {
    try {
      const r = await c.call({ to: plugin, data: encodeFunctionData({
        abi: [{ type: "function", name: "supportsInterface", stateMutability: "view",
                inputs: [{ type: "bytes4" }], outputs: [{ type: "bool" }] }],
        functionName: "supportsInterface", args: [id] }) });
      return BigInt(r.data) === 1n ? "YES" : "no";
    } catch { return "revert"; }
  };
  for (const id of dependencyInterfaceIds) {
    console.log(`    ${id}   Circle multisig: ${(await supports(CIRCLE_MULTISIG, id)).padEnd(6)} Alchemy MultiOwner: ${await supports(ALCHEMY_MULTIOWNER, id)}`);
  }
}
