/**
 * Can Alchemy's MultiOwnerPlugin be installed ALONGSIDE Circle's WebAuthn multisig, purely to
 * satisfy SessionKeyPlugin's dependency on 0xf23b1ed7?
 *
 * The blocker is collision: ERC-6900 v0.7 rejects installing a plugin whose execution functions
 * or validation slots are already claimed. If MultiOwner claims selectors Circle's multisig
 * already owns, coexistence is out.
 */
import { createPublicClient, http, toFunctionSelector } from "viem";
import { arcTestnet } from "viem/chains";
const c = createPublicClient({ chain: arcTestnet, transport: http() });

const P = {
  "Alchemy MultiOwnerPlugin": "0xcE0000007B008F50d762D155002600004cD6c647",
  "Circle WebAuthn multisig": "0x0000000C984AFf541D6cE86Bb697e68ec57873C8",
  "Alchemy SessionKeyPlugin": "0x0000003E0000a96de4058e1E02a62FaaeCf23d8d",
};

const manifestOf = async (addr) => {
  const { data } = await c.call({ to: addr, data: toFunctionSelector("function pluginManifest() view returns (bytes)") });
  const hex = data.slice(2);
  const word = (i) => hex.slice(i * 64, i * 64 + 64);
  const num = (i) => Number(BigInt("0x" + word(i)));
  const s = num(0) / 32;
  const arr = (slot) => {
    const at = s + num(s + slot) / 32;
    const n = num(at);
    return Array.from({ length: n }, (_, k) => "0x" + word(at + 1 + k).slice(0, 8));
  };
  return { interfaceIds: arr(0), dependencies: arr(1), executionFunctions: arr(2) };
};

const seen = {};
for (const [name, addr] of Object.entries(P)) {
  const m = await manifestOf(addr);
  seen[name] = m;
  console.log(`${name}`);
  console.log(`  interfaceIds      : ${m.interfaceIds.join(", ") || "(none)"}`);
  console.log(`  dependencies      : ${m.dependencies.join(", ") || "(none)"}`);
  console.log(`  executionFunctions: ${m.executionFunctions.length} ${m.executionFunctions.slice(0, 6).join(" ")}${m.executionFunctions.length > 6 ? " …" : ""}`);
  console.log();
}

const a = new Set(seen["Alchemy MultiOwnerPlugin"].executionFunctions);
const b = new Set(seen["Circle WebAuthn multisig"].executionFunctions);
const clash = [...a].filter((x) => b.has(x));
console.log("selector collisions between MultiOwner and Circle's multisig:",
  clash.length ? clash.join(", ") : "NONE — they can coexist");
