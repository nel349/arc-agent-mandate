import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { draw } from "../test/draw.tsx";
import { SettingsButton } from "./SettingsButton.tsx";
import { tokens } from "./tokens.ts";

// Where a tap goes is not tested here: expo-router refuses to navigate before its root layout is
// mounted, and drawing that layout means drawing the whole app. The route it opens is `ROUTES.settings`.
describe("the settings gear", () => {
  it("is a button named Settings, a full touch target wide", () => {
    draw(<SettingsButton />);
    expect(screen.getByRole("button", { name: "Settings" })).toHaveStyle({ width: `${tokens.size.tapTarget}px` });
  });
});
