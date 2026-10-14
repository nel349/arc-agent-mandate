import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { draw } from "../test/draw.tsx";
import { AgentChip } from "./AgentChip.tsx";

describe("the agent chip", () => {
  it("says who the allowance is for, with a way back to change it", () => {
    draw(<AgentChip who="Scout" onEdit={vi.fn()} />);
    const chip = screen.getByRole("button", { name: "For Scout. Change the agent" });
    expect(chip).toHaveTextContent("For Scout");
    expect(chip).toHaveTextContent("Edit");
  });

  it("goes back to the agent when tapped", async () => {
    const onEdit = vi.fn();
    draw(<AgentChip who="0x68C9 1FB4 … B17E" onEdit={onEdit} />);
    await userEvent.click(screen.getByRole("button", { name: /Change the agent/ }));
    expect(onEdit).toHaveBeenCalledOnce();
  });
});
