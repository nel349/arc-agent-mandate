import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { draw } from "../test/draw.tsx";
import { WizardTopBar } from "./WizardTopBar.tsx";
import { DEFAULT_THEME_ID, themeById } from "./themes.ts";

const c = themeById(DEFAULT_THEME_ID).color;

describe("the bar across a step", () => {
  it("names the step as a heading, with the quiet line under it, and a way back", async () => {
    const onBack = vi.fn();
    draw(<WizardTopBar title="How much" detail="On Arc Testnet" onBack={onBack} />);
    expect(screen.getByRole("heading", { name: "How much" })).toBeInTheDocument();
    expect(screen.getByText("On Arc Testnet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("on the first step the way back is Cancel, because it leaves the flow", () => {
    draw(<WizardTopBar title="Agent" onBack={vi.fn()} closes />);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("has no action and no line under the title unless given them", () => {
    draw(<WizardTopBar title="Agent" onBack={vi.fn()} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Agent" }).parentElement?.childElementCount).toBe(1);
  });

  it("its one action works when enabled", async () => {
    const onPress = vi.fn();
    draw(<WizardTopBar title="How much" onBack={vi.fn()} action={{ title: "Continue", enabled: true, onPress }} />);
    const action = screen.getByRole("button", { name: "Continue" });
    expect(action).not.toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Continue")).toHaveStyle({ color: c.paper });
    await userEvent.click(action);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("and when not, says so, is dimmed, and a tap does nothing", async () => {
    const onPress = vi.fn();
    draw(<WizardTopBar title="How much" onBack={vi.fn()} action={{ title: "Continue", enabled: false, onPress }} />);
    const action = screen.getByRole("button", { name: "Continue" });
    expect(action).toHaveAttribute("aria-disabled", "true");
    expect(action).toBeDisabled();
    expect(screen.getByText("Continue")).toHaveStyle({ color: c.dim });
    await userEvent.setup({ pointerEventsCheck: 0 }).click(action);
    expect(onPress).not.toHaveBeenCalled();
  });
});
