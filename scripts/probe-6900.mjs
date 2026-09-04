import { createPublicClient, http, toFunctionSelector, decodeAbiParameters, parseAbiParameters } from "viem";
import { arcTestnet } from "viem/chains";

const c = createPublicClient({ chain: arcTestnet, transport: http() });
const ACCOUNT = "0xa8546ff7d7fcd3bbd08c0ef31e74c73df6bcc447";
const ERC1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

// What plugins are installed?
const installed = await c.call({ to: ACCOUNT, data: toFunctionSelector("function getInstalledPlugins() view returns (address[])") });
const [plugins] = decodeAbiParameters(parseAbiParameters("address[]"), installed.data);
console.log("installed plugins:", plugins);

// The proxy's implementation — the actual MSCA logic contract.
const raw = await c.getStorageAt({ address: ACCOUNT, slot: ERC1967_IMPL_SLOT });
const impl = ("0x" + raw.slice(-40));
const implCode = await c.getCode({ address: impl });
console.log("implementation   :", impl, `(${(implCode.length - 2) / 2} bytes)`);

// Which ERC-6900 surface does the IMPLEMENTATION expose? (the proxy delegates to it)
const sigs = [
  ["installPlugin",       "function installPlugin(address,bytes32,bytes,bytes21[])"],
  ["uninstallPlugin",     "function uninstallPlugin(address,bytes,bytes)"],
  ["getInstalledPlugins", "function getInstalledPlugins() view returns (address[])"],
  ["execute",             "function execute(address,uint256,bytes) returns (bytes)"],
  ["executeBatch",        "function executeBatch(address[],uint256[],bytes[]) returns (bytes[])"],
  ["getExecutionFunctionConfig", "function getExecutionFunctionConfig(bytes4) view returns (address,bytes21)"],
  ["getPreValidationHooks",      "function getPreValidationHooks(bytes4) view returns (bytes21[],bytes21[])"],
];
console.log("\nselector on the implementation (via the proxy):");
for (const [label, sig] of sigs) {
  const sel = toFunctionSelector(sig);
  let out;
  try { const r = await c.call({ to: ACCOUNT, data: sel }); out = `OK ${(r.data?.length ?? 2 - 2) / 2}b`; }
  catch (e) { out = (e.shortMessage ?? e.message ?? "").includes("reverted") ? "revert (needs args or self-call)" : "err"; }
  console.log(`  ${label.padEnd(28)} ${sel}  ${out}`);
}
