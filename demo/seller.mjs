import { createServer } from "node:http";
import { createPublicClient, defineChain, formatEther, http, parseEther } from "viem";

/**
 * A service that charges per request, on the real chain.
 *
 * The shape an agent actually meets in the wild: ask, get told the price, pay, ask again. It is
 * deliberately not a mock — it reads the chain before it answers, so a request whose payment never
 * landed gets nothing. Nothing here trusts the agent's word for anything.
 *
 * It used to run against a forked anvil beside a scripted buyer, which made the whole thing a
 * play: the "agent" was a function called `buy()`, and what the demo proved — that a chain
 * enforces a spend limit — is what the contract and integration suites already prove properly. The
 * part worth showing is an actual agent deciding to pay, and that only means something against a
 * chain anyone can check.
 *
 *   ARC_RPC_URL     which chain to read (defaults to Arc testnet)
 *   SELLER_ADDRESS  where payment must land — required, since it decides who gets paid
 *   SELLER_PRICE    USDC per query (default 0.05)
 *   SELLER_PORT     default 4021
 */

const arc = defineChain({
  id: 5042002,
  name: "Arc testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.network"] } },
});

const SELLER = process.env.SELLER_ADDRESS;
if (!/^0x[0-9a-fA-F]{40}$/.test(SELLER ?? "")) {
  console.error("Set SELLER_ADDRESS to the address payments should land at.");
  process.exit(1);
}
const PRICE = parseEther(process.env.SELLER_PRICE ?? "0.05");
const PORT = Number(process.env.SELLER_PORT ?? 4021);

const publicClient = createPublicClient({ chain: arc, transport: http() });

/**
 * What the seller has already been paid, so a later request cannot be settled by an earlier
 * payment. Read once at startup and advanced only as requests are served.
 */
let settled = await publicClient.getBalance({ address: SELLER });

const json = (status, body) => [status, JSON.stringify(body)];

const ANSWERS = {
  weather: "Clear, 18°C, wind 6 km/h.",
  price: "USDC is a dollar. That is rather the point.",
};
const answer = (query) => ANSWERS[query] ?? `No data for "${query}".`;

createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${PORT}`);
  const query = url.searchParams.get("q") ?? "";

  const balance = await publicClient.getBalance({ address: SELLER });
  const paid = balance - settled;

  let [status, body] =
    paid >= PRICE
      ? (settled += PRICE, json(200, { query, answer: answer(query), charged: formatEther(PRICE) }))
      : json(402, {
          error: "payment required",
          price: PRICE.toString(),
          payTo: SELLER,
          currency: "USDC",
          chainId: arc.id,
        });

  response.writeHead(status, { "content-type": "application/json" });
  response.end(body);
}).listen(PORT, () =>
  console.log(
    `seller on :${PORT} — ${formatEther(PRICE)} USDC per query, paid to ${SELLER} on ${arc.name}`,
  ),
);
