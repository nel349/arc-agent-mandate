import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { draw } from "../test/draw.tsx";
import { ChoiceListRow } from "./ChoiceListRow.tsx";

describe("a choice row", () => {
  it("is one radio named by what it is and what it means, and a tap chooses it", async () => {
    const onPress = vi.fn();
    draw(<ChoiceListRow title="A week" detail="Ends 21 Oct" selected={false} onPress={onPress} first />);
    const row = screen.getByRole("radio", { name: "A week. Ends 21 Oct" });
    expect(row).toHaveTextContent("A week");
    expect(row).toHaveTextContent("Ends 21 Oct");
    expect(row).toHaveAttribute("aria-checked", "false");
    await userEvent.click(row);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("says it is chosen when it is", () => {
    draw(<ChoiceListRow title="A day" detail="Ends 15 Oct" selected onPress={vi.fn()} first />);
    expect(screen.getByRole("radio", { name: "A day. Ends 15 Oct" })).toHaveAttribute("aria-checked", "true");
  });

  it("only the first row in a group has no rule above it", () => {
    draw(
      <>
        <ChoiceListRow title="A day" detail="Ends 15 Oct" selected onPress={vi.fn()} first />
        <ChoiceListRow title="A week" detail="Ends 21 Oct" selected={false} onPress={vi.fn()} first={false} />
      </>,
    );
    const [top, below] = screen.getAllByRole("radio");
    expect(top).not.toHaveStyle({ borderTopWidth: "1px" });
    expect(below).toHaveStyle({ borderTopWidth: "1px" });
  });
});
