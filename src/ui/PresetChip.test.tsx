import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { draw } from "../test/draw.tsx";
import { PresetChip } from "./PresetChip.tsx";
import { DEFAULT_THEME_ID, themeById } from "./themes.ts";

const c = themeById(DEFAULT_THEME_ID).color;

describe("a preset amount", () => {
  it("is a button named by its amount, and a tap picks it", async () => {
    const onPress = vi.fn();
    draw(<PresetChip label="$5" selected={false} onPress={onPress} />);
    const chip = screen.getByRole("button", { name: "$5" });
    expect(chip).toHaveTextContent("$5");
    expect(chip).toHaveAttribute("aria-selected", "false");
    await userEvent.click(chip);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("the one picked says so, and is drawn in full ink", () => {
    draw(<PresetChip label="$10" selected onPress={vi.fn()} />);
    expect(screen.getByRole("button", { name: "$10" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("$10")).toHaveStyle({ color: c.paper });
  });

  it("one not picked is quieter", () => {
    draw(<PresetChip label="$20" selected={false} onPress={vi.fn()} />);
    expect(screen.getByText("$20")).toHaveStyle({ color: c.muted });
  });
});
