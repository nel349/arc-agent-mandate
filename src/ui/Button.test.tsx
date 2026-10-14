import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { draw } from "../test/draw.tsx";
import { Button } from "./Button.tsx";

/**
 * Tries the tap anyway. A button that cannot be pressed takes no pointer events, and Testing Library
 * refuses to tap one; a finger does not refuse, so the test checks nothing happens when it lands.
 */
const finger = () => userEvent.setup({ pointerEventsCheck: 0 });
import { DEFAULT_THEME_ID, themeById } from "./themes.ts";

const c = themeById(DEFAULT_THEME_ID).color;

describe("a button", () => {
  it("is a button named by its title, and a tap does what it says", async () => {
    const onPress = vi.fn();
    draw(<Button title="Grant" onPress={onPress} />);
    const button = screen.getByRole("button", { name: "Grant" });
    expect(button).toHaveTextContent("Grant");
    expect(button).not.toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("aria-busy", "false");
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("when disabled, says so to a screen reader and a tap does nothing", async () => {
    const onPress = vi.fn();
    draw(<Button title="Grant" onPress={onPress} disabled />);
    const button = screen.getByRole("button", { name: "Grant" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("aria-busy", "false");
    expect(button).toBeDisabled();
    await finger().click(button);
    await finger().keyboard("{Enter}");
    expect(onPress).not.toHaveBeenCalled();
  });

  it("while busy, shows a spinner in place of its title, keeps its name, and a tap does nothing", async () => {
    const onPress = vi.fn();
    draw(<Button title="Grant" onPress={onPress} busy />);
    const button = screen.getByRole("button", { name: "Grant" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toHaveTextContent("Grant");
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(button).toBeDisabled();
    await finger().click(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("the solid one is filled with the action colour and its words in the colour that reads on it", () => {
    draw(<Button title="Grant" tier="solid" onPress={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Grant" })).toHaveStyle({ backgroundColor: c.actionFill });
    expect(screen.getByText("Grant")).toHaveStyle({ color: c.actionText });
  });

  it("a glass one that takes something away has its words in the stop colour, and its fill stays glass", () => {
    draw(<Button title="Revoke" tone="warn" onPress={vi.fn()} />);
    // The lit top edge is glass's mark; the fill's alpha is rounded by the DOM, so it is not compared.
    expect(screen.getByRole("button", { name: "Revoke" })).toHaveStyle({ borderTopColor: c.specular });
    expect(screen.getByText("Revoke")).toHaveStyle({ color: c.stop });
  });

  it("draws its icon before the title when it has one, and nothing there when it has none", () => {
    const { unmount } = draw(<Button title="Scan" onPress={vi.fn()} />);
    const plain = screen.getByRole("button", { name: "Scan" }).firstElementChild?.childElementCount;
    unmount();
    draw(<Button title="Scan" icon="qr-code-outline" onPress={vi.fn()} />);
    const row = screen.getByRole("button", { name: "Scan" }).firstElementChild;
    expect(row?.childElementCount).toBe((plain ?? 0) + 1);
    expect(row?.lastElementChild).toHaveTextContent("Scan");
  });
});
