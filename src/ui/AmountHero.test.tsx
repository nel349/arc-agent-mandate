import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { draw } from "../test/draw.tsx";
import { AmountHero } from "./AmountHero.tsx";

/** The hero as a screen holds it: the typed value lives above it. */
function Typed({ unit, problem }: { readonly unit: string; readonly problem: string | null }) {
  const [value, setValue] = useState("");
  return <AmountHero value={value} onChangeText={setValue} unit={unit} problem={problem} />;
}

describe("the amount being typed", () => {
  it("is a field named for the coin, with the unit beside it and nothing typed yet", () => {
    draw(<AmountHero value="" onChangeText={vi.fn()} unit="USDC" problem={null} />);
    const field = screen.getByLabelText("Limit in USDC");
    expect(field).toHaveValue("");
    expect(field).toHaveAttribute("placeholder", "0");
    expect(screen.getByText("USDC")).toBeInTheDocument();
  });

  it("names the coin of the network it is on", () => {
    draw(<AmountHero value="" onChangeText={vi.fn()} unit="MON" problem={null} />);
    expect(screen.getByLabelText("Limit in MON")).toBeInTheDocument();
  });

  it("opens the number keyboard and stops at ten characters", () => {
    draw(<AmountHero value="" onChangeText={vi.fn()} unit="USDC" problem={null} />);
    const field = screen.getByLabelText("Limit in USDC");
    expect(field).toHaveAttribute("inputmode", "decimal");
    expect(field).toHaveAttribute("maxlength", "10");
  });

  it("hands each change to the screen", () => {
    const onChangeText = vi.fn();
    draw(<AmountHero value="" onChangeText={onChangeText} unit="USDC" problem={null} />);
    fireEvent.change(screen.getByLabelText("Limit in USDC"), { target: { value: "12.5" } });
    expect(onChangeText).toHaveBeenCalledWith("12.5");
  });

  it("keeps a problem to itself until there is a figure to judge", () => {
    draw(<Typed unit="USDC" problem="More than the wallet holds." />);
    expect(screen.queryByText("More than the wallet holds.")).toBeNull();
    fireEvent.change(screen.getByLabelText("Limit in USDC"), { target: { value: "900" } });
    expect(screen.getByText("More than the wallet holds.")).toBeInTheDocument();
  });

  it("says nothing under a figure that is fine", () => {
    draw(<AmountHero value="5" onChangeText={vi.fn()} unit="USDC" problem={null} />);
    expect(screen.getByLabelText("Limit in USDC")).toHaveValue("5");
    expect(screen.getAllByText(/./).map((n) => n.textContent)).toEqual(["USDC"]);
  });
});
