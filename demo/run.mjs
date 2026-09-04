import { encodeFunctionData, formatEther, parseAbi } from "viem";
import { publicClient, MSCA, SELLER, ENTRY_POINT, agent, RPC } from "./lib.mjs";
import { buy } from "./agent.mjs";

const PLUGIN = process.env.PLUGIN;
const pluginAbi = parseAbi([
  "function sessionKeysOf(address account) view returns (address[])",
  "function findPredecessor(address account, address sessionKey) view returns (bytes32)",
  "function removeSessionKey(address sessionKey, bytes32 predecessor)",
  "function getNativeTokenSpendLimitInfo(address account, address sessionKey) view returns ((bool hasLimit,uint256 limit,uint256 limitUsed,uint48 refreshInterval,uint48 lastUsedTime))",
]);

/// Every figure below is read back from the chain rather than written into the script. An earlier
/// version narrated hardcoded numbers, so changing the granted amount moved the refusal -- proving
/// the rule was real -- while the prose still claimed the old figure. A demo that says its own
/// numbers is only as trustworthy as its narration.
const mandate = async () => {
  const info = await publicClient.readContract({
    address: PLUGIN, abi: pluginAbi, functionName: "getNativeTokenSpendLimitInfo",
    args: [MSCA, agent.address],
  });
  return { limit: info.limit, used: info.limitUsed };
};

const usdc = async (a) => formatEther(await publicClient.getBalance({ address: a }));
const line = (s = "") => console.log(s);
const money = async (note = "") =>
  line(`    wallet ${(await usdc(MSCA)).padEnd(20)} seller ${(await usdc(SELLER)).padEnd(8)} ${note}`);

/// Revoking is an owner action. On the phone it is a face scan; here the fork impersonates the
/// EntryPoint, because that is the only route the account accepts for mandate management.
async function revoke() {
  const predecessor = await publicClient.readContract({
    address: PLUGIN, abi: pluginAbi, functionName: "findPredecessor", args: [MSCA, agent.address],
  });
  const data = encodeFunctionData({
    abi: pluginAbi, functionName: "removeSessionKey", args: [agent.address, predecessor],
  });
  const send = (method, params) =>
    fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((r) => r.json());
  await send("eth_sendTransaction", [{ from: ENTRY_POINT, to: MSCA, data, gas: "0x2dc6c0" }]);
}

line("\n═══ A MANDATE ════════════════════════════════════════════════════════");
const granted = (await mandate()).limit;
line(`  wallet holds ${await usdc(MSCA)} USDC   ·   agent may spend ${formatEther(granted)}   ·   one payee only`);
await money();

line("\n═══ THE AGENT GETS ON WITH IT ════════════════════════════════════════");
for (const q of ["acme-filings", "globex-filings", "initech-filings"]) {
  const r = await buy(q);
  line(`  paid ${r.price} USDC  →  ${r.answer.slice(0, 52)}…`);
}
await money("← nobody approved any of that");

line("\n═══ THE AGENT TRIES TO OVERSPEND ═════════════════════════════════════");
let spent = 6;
try {
  for (let i = 0; i < 10; i++) { await buy("acme-filings"); spent += 2; }
  line("  !! the mandate did not hold");
} catch (e) {
  const m = await mandate();
  line(`  refused — ${formatEther(m.used)} of ${formatEther(m.limit)} USDC already spent, and this call wanted 2 more`);
  line(`  the chain refused it during validation, so it cost nothing`);
}
await money(`← ${formatEther(await publicClient.getBalance({ address: MSCA }) - granted + (await mandate()).used)} USDC it could never touch`);

line("\n═══ THE HUMAN REVOKES ════════════════════════════════════════════════");
await revoke();
const remaining = await publicClient.readContract({
  address: PLUGIN, abi: pluginAbi, functionName: "sessionKeysOf", args: [MSCA],
});
line(`  session keys remaining: ${remaining.length}`);
try {
  await buy("acme-filings");
  line("  !! the agent still spent after revocation");
} catch (e) {
  line(`  the agent still holds its key, and can no longer spend a cent`);
}
await money();
line();
