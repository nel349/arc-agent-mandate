import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Text } from "react-native";
import { describe, expect, it } from "vitest";
import { draw } from "../test/draw.tsx";
import { Labelled } from "./Labelled.tsx";

describe("a labelled control", () => {
  it("shows the label over the control, and no question mark when there is nothing to explain", () => {
    draw(<Labelled label="Amount"><Text>the control</Text></Labelled>);
    expect(screen.getByText("Amount")).toBeInTheDocument();
    expect(screen.getByText("the control")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps the explanation behind a question mark, which opens and closes it", async () => {
    draw(<Labelled label="Amount" hint="The most it can spend."><Text>the control</Text></Labelled>);
    const about = screen.getByRole("button", { name: "About Amount. The most it can spend." });
    expect(screen.queryByText("The most it can spend.")).toBeNull();
    expect(about).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(about);
    expect(screen.getByText("The most it can spend.")).toBeInTheDocument();
    expect(about).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(about);
    expect(screen.queryByText("The most it can spend.")).toBeNull();
    expect(about).toHaveAttribute("aria-expanded", "false");
  });

  it("puts what the caller gives beside the label", () => {
    draw(<Labelled label="Agent" trailing={<Text>✓</Text>}><Text>the control</Text></Labelled>);
    expect(screen.getByText("✓")).toBeInTheDocument();
  });
});
