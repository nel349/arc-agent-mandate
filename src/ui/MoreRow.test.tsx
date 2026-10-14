import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { draw } from "../test/draw.tsx";
import { MoreRow } from "./MoreRow.tsx";

describe("the row that opens the whole list", () => {
  it("is a button named by what it opens", () => {
    draw(<MoreRow title="See all activity" onPress={vi.fn()} />);
    expect(screen.getByRole("button", { name: "See all activity" })).toHaveTextContent("See all activity");
  });

  it("opens it when tapped", async () => {
    const onPress = vi.fn();
    draw(<MoreRow title="See all activity" onPress={onPress} />);
    await userEvent.click(screen.getByRole("button", { name: "See all activity" }));
    expect(onPress).toHaveBeenCalledOnce();
  });
});
