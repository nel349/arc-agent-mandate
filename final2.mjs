import { parseEther, formatEther } from "viem";
import { loadOrCreateAgent } from "./mcp/identity.mjs";
import { publicClient } from "./mcp/chain.mjs";
import { submitSpend } from "./mcp/spend.mjs";
import { listMandates } from "./src/arc/mandate.ts";

const ACCOUNT = "0xc3bb7bc7e375f7ffa34e652f560dc802f7a76cfa";
const PAYEE = "0x68c91fb4f4e7f0236fd68c7d2605b5740787b17e";
const { account: agent } = loadOrCreateAgent();
const read = async () => ({
  account: await publicClient.getBalance({ address: ACCOUNT }),
  agent: await publicClient.getBalance({ address: agent.address }),
  payee: await publicClient.getBalance({ address: PAYEE }),
});
const before = await read();
const result = await submitSpend({ agent, account: ACCOUNT, to: PAYEE, value: parseEther("0.02") });
console.log("submitSpend:", JSON.stringify(result));
if (result.ok) {
  const after = await read();
  console.log("account", formatEther(after.account - before.account),
              "| agent", formatEther(after.agent - before.agent),
              "| payee", formatEther(after.payee - before.payee));
  const [m] = await listMandates(ACCOUNT);
  console.log(`mandate now: ${m.spent.format(2)} spent of ${m.limit.format(2)}, ${m.remaining.format(2)} left`);
  console.log("agent holds:", m.agentFloat.format(6), "(dust from an earlier reverted return, not from a grant)");
}
