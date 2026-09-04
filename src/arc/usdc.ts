/**
 * USDC on Arc, as a type.
 *
 * Arc's native token *is* USDC, and the same balance is visible two ways:
 *
 *   - **native** — 18 decimals; gas, `msg.value`, native sends
 *   - **ERC-20** at `0x3600…` — 6 decimals; `transfer`, `approve`, allowances
 *
 * They are one balance at two scales, and the ERC-20 view **truncates**: a native balance of
 * 0.0000001 USDC reads as `0` through `balanceOf`. So a `balanceOf` of zero does not mean the
 * account is empty.
 *
 * A wrong amount here renders as a *plausible* number rather than an obviously broken one,
 * which is the worst failure mode a balance has. Hence a type: the raw integers are reachable
 * only through conversions that name their scale at the call site.
 */

const NATIVE_DECIMALS = 18n;
const ERC20_DECIMALS = 6n;
const NATIVE_PER_ERC20 = 10n ** (NATIVE_DECIMALS - ERC20_DECIMALS); // 1e12

export class UsdcError extends Error {
  constructor(message: string) { super(message); this.name = "UsdcError"; }
}

/** An amount of USDC, held at native (18-decimal) precision — the widest of the two views. */
export class Usdc {
  // A `#private` field rather than a parameter property. The original reason was that Node's
  // strip-only type removal could not handle parameter properties; that constraint is gone
  // (the test script now passes `--experimental-transform-types`). Kept because true privacy
  // at runtime is worth more here than the brevity — nothing outside this class can reach the
  // raw integer, which is the whole point of the type.
  readonly #nativeUnits: bigint;

  private constructor(nativeUnits: bigint) {
    this.#nativeUnits = nativeUnits;
  }

  /** From a decimal string such as `"12.50"`. The only lossless way to write a literal amount. */
  static parse(decimal: string): Usdc {
    const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(decimal.trim());
    if (!match) throw new UsdcError(`not a decimal amount: ${JSON.stringify(decimal)}`);
    const [, sign, whole, fraction = ""] = match;
    if (fraction.length > Number(NATIVE_DECIMALS)) {
      throw new UsdcError(`more than ${NATIVE_DECIMALS} decimal places: ${decimal}`);
    }
    const padded = fraction.padEnd(Number(NATIVE_DECIMALS), "0");
    const units = BigInt(whole! + padded);
    return new Usdc(sign === "-" ? -units : units);
  }

  /** From `eth_getBalance`, `msg.value`, or any other native-scale integer. */
  static fromNativeUnits(units: bigint): Usdc { return new Usdc(units); }

  /** From `balanceOf` or an ERC-20 `transfer` amount — 6-decimal scale. */
  static fromErc20Units(units: bigint): Usdc { return new Usdc(units * NATIVE_PER_ERC20); }

  static readonly ZERO = new Usdc(0n);

  /** Native scale — for `value` on a call, or comparing against `eth_getBalance`. */
  toNativeUnits(): bigint { return this.#nativeUnits; }

  /**
   * ERC-20 scale — for `transfer`/`approve` calldata. **Truncates**, exactly as the chain's own
   * ERC-20 view does, so the result can be zero for a non-zero amount. `hasErc20Dust()` tells
   * you when that has happened.
   */
  toErc20Units(): bigint { return this.#nativeUnits / NATIVE_PER_ERC20; }

  /** True when this amount carries precision the 6-decimal view cannot express. */
  hasErc20Dust(): boolean { return this.#nativeUnits % NATIVE_PER_ERC20 !== 0n; }

  add(other: Usdc): Usdc { return new Usdc(this.#nativeUnits + other.#nativeUnits); }
  subtract(other: Usdc): Usdc { return new Usdc(this.#nativeUnits - other.#nativeUnits); }
  isZero(): boolean { return this.#nativeUnits === 0n; }
  isNegative(): boolean { return this.#nativeUnits < 0n; }
  compare(other: Usdc): number {
    return this.#nativeUnits === other.#nativeUnits ? 0 : this.#nativeUnits < other.#nativeUnits ? -1 : 1;
  }

  /** Human-readable, rounded down to `places`. Display only — never parse this back. */
  format(places = 2): string {
    const negative = this.#nativeUnits < 0n;
    const magnitude = negative ? -this.#nativeUnits : this.#nativeUnits;
    const scale = 10n ** NATIVE_DECIMALS;
    const whole = magnitude / scale;
    const fraction = (magnitude % scale).toString().padStart(Number(NATIVE_DECIMALS), "0");
    const shown = places > 0 ? `.${fraction.slice(0, places)}` : "";
    return `${negative ? "-" : ""}${whole}${shown}`;
  }

  toString(): string { return `${this.format(6)} USDC`; }
}
