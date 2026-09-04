import { formatEther } from "viem";
import { publicClient, MSCA, SELLER } from "./lib.mjs";
const b = async (a) => formatEther(await publicClient.getBalance({ address: a }));
console.log("seller (0x3C44…) balance now:", await b(SELLER));
console.log("seller code length:", (await publicClient.getBytecode({ address: SELLER }))?.length ?? 0);
console.log("account balance now       :", await b(MSCA));
// Where else could it be? The plugin, and the account's own executor path.
for (const [name, a] of [
  ["plugin        ", "0x36BAf7ED75E52e0f60b5051267Ee91Fa04F5663A"],
  ["entryPoint    ", "0x0000000071727De22E5E9d8BAf0edAc6f37da032"],
  ["bundler #0    ", "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"],
]) console.log(name, "balance:", await b(a));
