import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { draw } from "../test/draw.tsx";
import { ERROR_LINES, Note } from "./Note.tsx";
import { DEFAULT_THEME_ID, themeById } from "./themes.ts";

const c = themeById(DEFAULT_THEME_ID).color;

describe("a note", () => {
  it("states a fact quietly, in dim ink", () => {
    draw(<Note>You can revoke it at any time.</Note>);
    expect(screen.getByText("You can revoke it at any time.")).toHaveStyle({ color: c.dim });
  });

  it("a warning takes the attention colour", () => {
    draw(<Note tone="warn">Could not reach Arc Testnet.</Note>);
    expect(screen.getByText("Could not reach Arc Testnet.")).toHaveStyle({ color: c.warn });
  });

  it("cuts a failure it did not write at the lines it is given, and leaves its own sentences whole", () => {
    const { unmount } = draw(<Note tone="warn" lines={ERROR_LINES}>{"0xdeadbeef".repeat(80)}</Note>);
    expect(screen.getByText(/deadbeef/).style.getPropertyValue("-webkit-line-clamp")).toBe(String(ERROR_LINES));
    unmount();
    draw(<Note>Granting this lets the agent spend.</Note>);
    expect(screen.getByText("Granting this lets the agent spend.").style.getPropertyValue("-webkit-line-clamp")).toBe("");
  });
});
