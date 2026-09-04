import { formatEther, decodeEventLog, parseAbi } from "viem";
import { publicClient, payFromMandate, MSCA, SELLER, ENTRY_POINT } from "./lib.mjs";

const epEvents = parseAbi([
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
  "event UserOperationRevertReason(bytes32 indexed userOpHash, address indexed sender, uint256 nonce, bytes revertReason)",
]);

const b = async (a) => publicClient.getBalance({ address: a });
console.log("before  seller:", formatEther(await b(SELLER)), " account:", formatEther(await b(MSCA)));
const receipt = await payFromMandate({ to: SELLER, value: 10n ** 18n });
console.log("after   seller:", formatEther(await b(SELLER)), " account:", formatEther(await b(MSCA)));

for (const log of receipt.logs) {
  try {
    const ev = decodeEventLog({ abi: epEvents, data: log.data, topics: log.topics });
    if (ev.eventName === "UserOperationEvent") {
      console.log(`\nUserOperationEvent success=${ev.args.success} gasCost=${formatEther(ev.args.actualGasCost)}`);
    }
    if (ev.eventName === "UserOperationRevertReason") {
      console.log(`\nREVERTED: ${ev.args.revertReason}`);
    }
  } catch {}
}
