import { screen } from "@testing-library/react";
import { Text, View } from "react-native";
import { describe, expect, it } from "vitest";
import { draw } from "../test/draw.tsx";
import { Surface } from "./Surface.tsx";
import { DEFAULT_THEME_ID, themeById } from "./themes.ts";

const c = themeById(DEFAULT_THEME_ID).color;

describe("a pane of glass", () => {
  it("holds what is given to it, with a brighter top edge than its sides", () => {
    draw(<View testID="pane-parent"><Surface><Text>Inside</Text></Surface></View>);
    const pane = screen.getByTestId("pane-parent").firstElementChild as HTMLElement;
    expect(pane).toContainElement(screen.getByText("Inside"));
    expect(pane).toHaveStyle({ borderTopColor: c.specular, borderLeftColor: c.hairline, borderRightColor: c.hairline });
  });

  it("takes a caller's own style on top of its own", () => {
    draw(<View testID="pane-parent"><Surface style={{ marginTop: 7 }}><Text>Inside</Text></Surface></View>);
    expect(screen.getByTestId("pane-parent").firstElementChild).toHaveStyle({ marginTop: "7px" });
  });
});
