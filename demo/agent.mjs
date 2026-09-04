import { formatEther } from "viem";
import { payFromMandate } from "./lib.mjs";

/**
 * The agent.
 *
 * It holds one key and no authority of its own. Every purchase is a user operation the chain
 * validates against the mandate before anything moves -- so "the agent behaves" is not a property
 * of this file, and nothing here could be written to spend more than it was granted.
 */
export async function buy(query) {
  const quote = await fetch(`http://localhost:4021/?q=${query}`);
  if (quote.status !== 402) throw new Error(`expected a price, got ${quote.status}`);
  const { price, payTo } = await quote.json();

  const receipt = await payFromMandate({ to: payTo, value: BigInt(price) });

  const answered = await fetch(`http://localhost:4021/?q=${query}`, {
    headers: { "x-payment": receipt.transactionHash },
  });
  const body = await answered.json();
  if (answered.status !== 200) throw new Error(body.error);
  return { ...body, price: formatEther(BigInt(price)) };
}
