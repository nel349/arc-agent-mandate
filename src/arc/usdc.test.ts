import { test } from "node:test";
import assert from "node:assert/strict";
import { Usdc, UsdcError } from "./usdc.ts";
import { parseUnits, formatUnits } from "viem";

/** Oracle is viem's own fixed-point conversion, which is independent of this code. */

test("parses to native scale exactly as viem does", () => {
  for (const amount of ["0", "1", "12.5", "0.000001", "0.000000000000000001", "123456.789"]) {
    assert.equal(Usdc.parse(amount).toNativeUnits(), parseUnits(amount, 18), amount);
  }
});

test("the ERC-20 view truncates — the trap this type exists to close", () => {
  // A native balance of 1e-7 USDC is real money the 6-decimal view cannot see.
  const dust = Usdc.parse("0.0000001");
  assert.equal(dust.toErc20Units(), 0n, "balanceOf would report zero");
  assert.ok(!dust.isZero(), "but the amount is not zero");
  assert.ok(dust.hasErc20Dust(), "and the type says so");
});

test("100.0000001 reads as 100 through the ERC-20 view", () => {
  const amount = Usdc.parse("100.0000001");
  assert.equal(amount.toErc20Units(), parseUnits("100", 6));
  assert.ok(amount.hasErc20Dust());
});

test("round-trips through both scales", () => {
  const fromErc20 = Usdc.fromErc20Units(parseUnits("42.5", 6));
  assert.equal(fromErc20.toNativeUnits(), parseUnits("42.5", 18));
  assert.equal(fromErc20.toErc20Units(), parseUnits("42.5", 6));
  assert.ok(!fromErc20.hasErc20Dust());
});

test("formats against viem, truncating rather than rounding", () => {
  const amount = Usdc.parse("12.999999");
  assert.equal(amount.format(2), "12.99", "truncates — never round money up");
  assert.equal(amount.format(0), "12");
  assert.equal(formatUnits(amount.toNativeUnits(), 18), "12.999999");
});

test("arithmetic stays at native precision", () => {
  const sum = Usdc.parse("0.0000001").add(Usdc.parse("0.0000009"));
  assert.equal(sum.toNativeUnits(), parseUnits("0.000001", 18));
  assert.equal(sum.toErc20Units(), 1n, "now visible to the ERC-20 view");
  assert.ok(!sum.hasErc20Dust());
});

test("handles negatives and comparison", () => {
  const owed = Usdc.parse("5").subtract(Usdc.parse("8"));
  assert.ok(owed.isNegative());
  assert.equal(owed.format(2), "-3.00");
  assert.equal(Usdc.parse("1").compare(Usdc.parse("2")), -1);
  assert.equal(Usdc.parse("2").compare(Usdc.parse("2")), 0);
});

test("rejects input it cannot represent", () => {
  assert.throws(() => Usdc.parse("1.2.3"), UsdcError);
  assert.throws(() => Usdc.parse("abc"), UsdcError);
  assert.throws(() => Usdc.parse(""), UsdcError);
  assert.throws(() => Usdc.parse("0.0000000000000000001"), UsdcError, "19 decimal places");
});
