import { screen } from "@testing-library/react";
import { Text } from "react-native";
import { describe, expect, it } from "vitest";
import { draw } from "../test/draw.tsx";
import { TabBarInsets, useTabBarHeight } from "./TabBarInsets.tsx";

function Height() {
  return <Text>{`under the bar: ${useTabBarHeight()}`}</Text>;
}

describe("the room the tab bar takes", () => {
  it("is nothing outside the tabs, where there is no bar", () => {
    draw(<Height />);
    expect(screen.getByText("under the bar: 0")).toBeInTheDocument();
  });

  it("is nothing inside them in a browser either, where the bar is not drawn over the screen", () => {
    draw(<TabBarInsets><Height /></TabBarInsets>);
    expect(screen.getByText("under the bar: 0")).toBeInTheDocument();
  });
});
