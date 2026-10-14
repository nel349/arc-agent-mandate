/**
 * Deploys the session-key plugin through the CREATE2 factory, so it lands where every network expects
 * it: 0x669Dd1eDb85ABD00f74186d88124614EE81E6670, the address `networks.ts` names on Arc testnet.
 *
 * The Foundry script does the same with `forge script --broadcast`, which takes the deploying key on
 * the command line. This reads it from a file, so it never reaches shell history or a process list,
 * and it checks the address before and after, from the same build the Foundry script compiles.
 *
 *   node --experimental-transform-types scripts/deploy-plugin.ts --rpc=https://rpc.mainnet.arc.io
 *   node --experimental-transform-types scripts/deploy-plugin.ts --rpc=https://rpc.mainnet.arc.io --send --from-file=<key file>
 *
 * Dry by default: it says where the plugin will land and whether it is there already. `--send` is the
 * word that spends. Build first with `forge build` in `contracts/` if `contracts/out` is missing.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  concat, createPublicClient, createWalletClient, defineChain, formatEther, getAddress, http, keccak256,
  stringToBytes, type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

/** Arachnid's factory, the same address on every chain that has it, and checked here before use. */
const FACTORY: Address = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
/** The Foundry script's salt, so both ways of deploying put the plugin at one address. */
const SALT = keccak256(stringToBytes("kuiralabs.arc-agent-mandate.SessionKeyPlugin.v1"));
/** Where it has to land: the address the profiles already name. Anything else is refused. */
const EXPECTED: Address = "0x669Dd1eDb85ABD00f74186d88124614EE81E6670";

const rpc = arg("rpc");
if (!rpc) {
  console.error("Name the network's node: --rpc=<url>, e.g. https://rpc.mainnet.arc.io");
  process.exit(1);
}
const send = process.argv.includes("--send");

const artifactPath = join(dirname(fileURLToPath(import.meta.url)), "../contracts/out/SessionKeyPlugin.sol/SessionKeyPlugin.json");
const artifact = JSON.parse(readFileSync(artifactPath, { encoding: "utf8" })) as { bytecode: { object: Hex } };
const initCode = artifact.bytecode.object;
const predicted = getAddress(`0x${keccak256(concat(["0xff", FACTORY, SALT, keccak256(initCode)])).slice(-40)}`);

const probe = createPublicClient({ transport: http(rpc) });
const chainId = await probe.getChainId();
const chain = defineChain({
  id: chainId, name: `chain ${chainId}`,
  nativeCurrency: { name: "native", symbol: "native", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const pub = createPublicClient({ chain, transport: http(rpc) });

console.log(`chain        ${chainId}`);
console.log(`predicted    ${predicted}`);
if (predicted !== EXPECTED) {
  console.error(`\nThis build would land at ${predicted}, not ${EXPECTED}, where the networks expect the plugin.`);
  console.error("The source or the compiler settings differ from the deployed build. Nothing sent.");
  process.exit(1);
}

const already = await pub.getCode({ address: predicted });
if (already && already !== "0x") {
  console.log(`\nalready deployed, ${(already.length - 2) / 2} bytes. Nothing to do.`);
  process.exit(0);
}
const factoryCode = await pub.getCode({ address: FACTORY });
if (!factoryCode || factoryCode === "0x") {
  console.error(`\nno CREATE2 factory at ${FACTORY} on this chain. It would have to be deployed first.`);
  process.exit(1);
}

if (!send) {
  console.log("\nDry run. Nothing was sent. Add --send and --from-file=<a file holding the deploying key> to deploy.");
  process.exit(0);
}

const keyFile = arg("from-file");
if (!keyFile) { console.error("\nName the deploying key: --from-file=<path to a file holding it alone>"); process.exit(1); }
const raw = readFileSync(keyFile, "utf8").trim();
if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) { console.error("that file does not hold a usable key"); process.exit(1); }

const deployer = privateKeyToAccount(raw as Hex);
const wallet = createWalletClient({ account: deployer, chain, transport: http(rpc) });
console.log(`\ndeployer     ${deployer.address}`);
console.log(`  holds      ${formatEther(await pub.getBalance({ address: deployer.address }))}`);

console.log("\ndeploying through the factory...");
const hash = await wallet.sendTransaction({ to: FACTORY, data: concat([SALT, initCode]), type: "eip1559" });
const receipt = await pub.waitForTransactionReceipt({ hash });
console.log(`  ${hash}  ${receipt.status}`);

const code = await pub.getCode({ address: predicted });
if (!code || code === "0x") {
  console.error("\nthe transaction landed and there is no code at the predicted address.");
  process.exit(1);
}
console.log(`\n✓ SessionKeyPlugin at ${predicted}, ${(code.length - 2) / 2} bytes`);
