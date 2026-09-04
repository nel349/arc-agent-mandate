import { createServer } from "node:http";
import { formatEther, parseEther } from "viem";
import { publicClient, SELLER } from "./lib.mjs";

/**
 * A service that charges per request.
 *
 * The shape an agent actually meets in the wild: ask, get told the price, pay, ask again. It is
 * deliberately not a mock -- it checks the chain before it answers, so a payment that did not
 * happen gets no data.
 */
const PRICE = parseEther("2"); // $2 per query
const consumed = new Set();
let settled = await publicClient.getBalance({ address: SELLER });

const DATA = {
  "acme-filings": "ACME Corp 10-K: revenue $412M, up 8% YoY, 3 risk factors added.",
  "globex-filings": "Globex Inc 10-Q: revenue $88M, down 2% QoQ, auditor unchanged.",
  "initech-filings": "Initech 8-K: CFO departure announced, effective 2026-10-01.",
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const query = url.searchParams.get("q") ?? "";
  const payment = req.headers["x-payment"];
  const json = (code, body) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (!payment) {
    return json(402, { error: "payment required", price: PRICE.toString(), payTo: SELLER, currency: "USDC" });
  }
  if (consumed.has(payment)) return json(402, { error: "that payment was already spent" });

  // Verify against the chain, not against the claim: the seller's balance must actually have
  // grown by the price since the last settled request.
  const balance = await publicClient.getBalance({ address: SELLER });
  if (balance - settled < PRICE) {
    return json(402, { error: "payment not observed on chain", expected: formatEther(PRICE) });
  }
  settled += PRICE;
  consumed.add(payment);

  const answer = DATA[query] ?? `No filings matched "${query}".`;
  json(200, { query, answer, paid: formatEther(PRICE) });
}).listen(4021, () => console.log(`seller listening on :4021, charging ${formatEther(PRICE)} USDC/query, paid to ${SELLER}`));
