import { createServer } from "node:http";
import { createPublicClient, defineChain, formatEther, http, parseEther } from "viem";

/**
 * A fake shop, for faking a paid API. Run it only when you mean to.
 *
 * **Nothing in this project uses it.** Not the app, not the connector, not the mandate. It exists
 * so a 402 flow can be exercised by hand — ask, get told a price, pay, ask again — and it is
 * started deliberately or not at all:
 *
 *   SELLER_ADDRESS=0xYourPayee node fixtures/seller.mjs
 *
 * It must never be started as part of demonstrating something. A counterparty you launch yourself,
 * on localhost, moments earlier, is not a counterparty: it is paying a script you control, which
 * proves nothing that a plain transfer does not, and it makes the whole thing read as theatre. A
 * purchase is only worth showing against a service you did not write.
 *
 * What it does do honestly: it reads the chain before it answers, so a request whose payment never
 * landed gets nothing. It cannot be talked into serving on credit.
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
