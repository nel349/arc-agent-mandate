import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { draw } from "../test/draw.tsx";
import { LinkRow } from "./LinkRow.tsx";

describe("a row that goes somewhere", () => {
  it("is a link named by where it goes, with a line saying what is there", () => {
    draw(<LinkRow href="/settings" name="Appearance" note="Pulse" hint="Opens the colour themes" />);
    const link = screen.getByRole("link", { name: "Appearance. Opens the colour themes" });
    expect(link).toHaveTextContent("Appearance");
    expect(link).toHaveTextContent("Pulse");
  });

  it("goes to the address it was given, as a real link the browser can open", () => {
    draw(<LinkRow href="/settings" name="Appearance" note="Pulse" hint="Opens the colour themes" />);
    expect(screen.getByRole("link", { name: /^Appearance/ })).toHaveAttribute("href", "/settings");
  });

  // react-native-web 0.21 has no `accessibilityHint`, so on the web the hint is the end of the name.
  it("tells a screen reader where it goes", () => {
    draw(<LinkRow href="/settings" name="Appearance" note="Pulse" hint="Opens the colour themes" />);
    expect(screen.getByRole("link")).toHaveAccessibleName("Appearance. Opens the colour themes");
  });
});
