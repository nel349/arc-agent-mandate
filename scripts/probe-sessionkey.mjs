import { createPublicClient, http, toFunctionSelector, keccak256 } from "viem";
import { arcTestnet } from "viem/chains";
const c = createPublicClient({ chain: arcTestnet, transport: http() });
const SKP = "0x0000003E0000a96de4058e1E02a62FaaeCf23d8d";

const call = async (data) => {
  try { const r = await c.call({ to: SKP, data }); return r.data ?? "0x"; }
  catch (e) { return null; }
};

// Is it a real ERC-6900 v0.7 plugin?
const manifest = await call(toFunctionSelector("function pluginManifest() view returns (bytes)"));
const metadata = await call(toFunctionSelector("function pluginMetadata() view returns (bytes)"));
console.log("  pluginManifest():", manifest ? `${(manifest.length - 2) / 2} bytes` : "revert");
console.log("  pluginMetadata():", metadata ? `${(metadata.length - 2) / 2} bytes` : "revert");
if (manifest) console.log("  manifestHash    :", keccak256(manifest));

// Does it expose the SessionKeyPlugin surface?
console.log("\n  session-key functions:");
for (const sig of [
  "function addSessionKey(address,bytes32,bytes[])",
  "function removeSessionKey(address,bytes32,bytes)",
  "function rotateSessionKey(address,bytes32,address)",
  "function executeWithSessionKey((address,uint256,bytes)[],address) returns (bytes[])",
  "function isSessionKeyOf(address,address) view returns (bool)",
  "function sessionKeysOf(address) view returns (address[])",
  "function getKeyTimeRange(address,address) view returns (uint48,uint48)",
]) {
  const name = sig.split(" ")[1].split("(")[0];
  const sel = toFunctionSelector(sig);
  const r = await call(sel);
  console.log(`    ${name.padEnd(22)} ${sel}  ${r === null ? "revert (needs args)" : "OK"}`);
}

// Its metadata names itself — decode the readable strings.
if (metadata) {
  const text = Buffer.from(metadata.slice(2), "hex").toString("latin1").replace(/[^\x20-\x7e]+/g, " ").trim();
  console.log("\n  metadata strings:", text.slice(0, 160));
}
