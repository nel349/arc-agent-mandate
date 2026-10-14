import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { draw } from "../test/draw.tsx";
import { Label } from "./Label.tsx";
import { DEFAULT_THEME_ID, themeById } from "./themes.ts";

const c = themeById(DEFAULT_THEME_ID).color;

describe("a section heading", () => {
  it("says what the group under it is, in the muted ink by default", () => {
    draw(<Label>Your agents</Label>);
    expect(screen.getByText("Your agents")).toHaveStyle({ color: c.muted });
  });

  it("is dimmer when it only names what is already obvious", () => {
    draw(<Label dim>Activity</Label>);
    expect(screen.getByText("Activity")).toHaveStyle({ color: c.dim });
  });
});
