import { formatEther } from "viem";
import { publicClient, payFromMandate, MSCA, SELLER } from "./lib.mjs";

const before = await publicClient.getBalance({ address: SELLER });
const receipt = await payFromMandate({ to: SELLER, value: 10n ** 18n }); // $1
const after = await publicClient.getBalance({ address: SELLER });

console.log("status        :", receipt.status);
console.log("seller +      :", formatEther(after - before), "USDC");
console.log("account       :", formatEther(await publicClient.getBalance({ address: MSCA })), "USDC");
console.log("\nlogs emitted for this payment:");
for (const log of receipt.logs) {
  console.log(`  ${log.address}  topic0=${log.topics[0]?.slice(0, 18)}…  topics=${log.topics.length}`);
}
