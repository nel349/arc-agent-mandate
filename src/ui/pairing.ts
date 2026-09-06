import { isAddress, type Address } from "viem";

/**
 * The agent address inside a scanned code, or `null` if there is not one.
 *
 * Pure and separate from the screen so the parsing can be tested without a camera — which matters
 * more here than usual, because the only way to exercise it on a device is to point a phone at a
 * laptop, and that is not a thing a test can do.
 *
 * Three shapes are accepted. The connector prints a bare address, which is the common case. An
 * `ethereum:` URI is what a wallet elsewhere would produce, and refusing it would be pedantic
 * when the address is right there. Surrounding whitespace comes free with a lot of scanners.
 */
export function pairedAddress(scanned: string): Address | null {
  const text = scanned.trim();

  // ethereum:0xabc… , optionally with @chainId or ?params, per EIP-681.
  const uri = /^ethereum:(?:pay-)?(0x[0-9a-fA-F]{40})(?:@\d+)?(?:[?/].*)?$/.exec(text);
  const candidate = uri?.[1] ?? text;

  return isAddress(candidate) ? candidate : null;
}
