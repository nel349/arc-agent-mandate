import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { draw } from "../test/draw.tsx";
import { IconButton } from "./IconButton.tsx";
import { DEFAULT_THEME_ID, themeById } from "./themes.ts";
import { tokens } from "./tokens.ts";

const c = themeById(DEFAULT_THEME_ID).color;

describe("a round control", () => {
  it("is a button named by its label, and a tap does what it says", async () => {
    const onPress = vi.fn();
    draw(<IconButton icon="settings-outline" label="Settings" onPress={onPress} />);
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("as a disclosure, says whether what it opens is open", () => {
    const { rerender } = draw(<IconButton glyph="?" label="About Amount" onPress={vi.fn()} />);
    expect(screen.getByRole("button", { name: "About Amount" })).toHaveAttribute("aria-expanded", "false");
    rerender(<IconButton glyph="?" label="About Amount" active onPress={vi.fn()} />);
    expect(screen.getByRole("button", { name: "About Amount" })).toHaveAttribute("aria-expanded", "true");
  });

  it("shows its single glyph, lit in full ink while open and dim while closed", () => {
    const { rerender } = draw(<IconButton glyph="?" label="About Amount" onPress={vi.fn()} />);
    expect(screen.getByText("?")).toHaveStyle({ color: c.dim });
    rerender(<IconButton glyph="?" label="About Amount" active onPress={vi.fn()} />);
    expect(screen.getByText("?")).toHaveStyle({ color: c.paper });
  });

  it("is a square of the size asked for, the header's by default", () => {
    const { unmount } = draw(<IconButton glyph="?" label="About" onPress={vi.fn()} />);
    const header = `${tokens.size.control.header}px`;
    expect(screen.getByRole("button", { name: "About" })).toHaveStyle({ width: header, height: header });
    unmount();
    draw(<IconButton glyph="?" label="About" size={tokens.size.control.hint} onPress={vi.fn()} />);
    const hint = `${tokens.size.control.hint}px`;
    expect(screen.getByRole("button", { name: "About" })).toHaveStyle({ width: hint, height: hint });
  });
});
