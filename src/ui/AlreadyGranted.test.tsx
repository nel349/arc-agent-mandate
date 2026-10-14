import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { draw } from "../test/draw.tsx";
import { AlreadyGranted } from "./AlreadyGranted.tsx";
import { ALREADY_GRANTED } from "./failure.ts";

describe("an agent that already has an allowance", () => {
  it("is said as a warning, with the one thing that can be done about it", () => {
    draw(<AlreadyGranted onOpen={vi.fn()} />);
    expect(screen.getByText(ALREADY_GRANTED)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open This Agent's Allowance" })).toBeInTheDocument();
  });

  it("opens that agent's allowance when tapped", async () => {
    const onOpen = vi.fn();
    draw(<AlreadyGranted onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: "Open This Agent's Allowance" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
