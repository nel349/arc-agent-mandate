import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { draw } from "../test/draw.tsx";
import { DetailRow } from "./DetailRow.tsx";

describe("a label and its value", () => {
  it("is read as one line, label then value, and is not a link", () => {
    draw(<DetailRow label="Limit" value="20.00 USDC" first />);
    expect(screen.getByLabelText("Limit: 20.00 USDC")).toHaveTextContent("Limit20.00 USDC");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("becomes a link when it opens somewhere, saying where for a screen reader", async () => {
    const onPress = vi.fn();
    draw(<DetailRow label="Transaction" value="0xa358…d6d3" data onPress={onPress} hint="Opens ArcScan" />);
    const link = screen.getByRole("link", { name: "Transaction: 0xa358…d6d3. Opens ArcScan" });
    await userEvent.click(link);
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("draws a rule above every row but the first in its group", () => {
    draw(
      <>
        <DetailRow label="One" value="1" first />
        <DetailRow label="Two" value="2" />
      </>,
    );
    expect(screen.getByLabelText("One: 1").style.borderTopWidth).toBe("");
    expect(screen.getByLabelText("Two: 2").style.borderTopWidth).toBe("1px");
  });
});
