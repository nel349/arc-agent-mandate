import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Text } from "react-native";
import { describe, expect, it, vi } from "vitest";
import { draw } from "../test/draw.tsx";
import { Field } from "./Field.tsx";
import { DEFAULT_THEME_ID, themeById } from "./themes.ts";

const c = themeById(DEFAULT_THEME_ID).color;
const NOT_AN_ADDRESS = "That is not an address.";

/** The field as a screen holds it: the value is the screen's, and the problem is judged from it. */
function AddressField({ start = "", onDone }: { readonly start?: string; readonly onDone?: () => void }) {
  const [value, setValue] = useState(start);
  return (
    <Field
      label="Agent's address"
      value={value}
      onChangeText={setValue}
      placeholder="0x…"
      data
      problem={/^0x[0-9a-fA-F]{40}$/.test(value) ? null : NOT_AN_ADDRESS}
      confirmed={/^0x[0-9a-fA-F]{40}$/.test(value)}
      {...(onDone === undefined ? {} : { onDone })}
    />
  );
}

const GOOD = "0xEe1933BbBC8acd7B32caD469D4f22Ca5B19d7918";

describe("a field", () => {
  it("keeps its label in view and names the input by it", () => {
    draw(<AddressField />);
    expect(screen.getByText("Agent's address")).toBeInTheDocument();
    expect(screen.getByLabelText("Agent's address")).toHaveAttribute("placeholder", "0x…");
  });

  it("says nothing about a field nobody has reached yet", () => {
    draw(<AddressField />);
    expect(screen.queryByText(NOT_AN_ADDRESS)).toBeNull();
    expect(screen.getByLabelText("Agent's address")).toHaveStyle({ borderTopColor: c.hairline });
  });

  it("says what is wrong as soon as something wrong is typed, with a warning edge", async () => {
    draw(<AddressField />);
    await userEvent.type(screen.getByLabelText("Agent's address"), "0x12");
    expect(screen.getByText(NOT_AN_ADDRESS)).toBeInTheDocument();
    expect(screen.getByLabelText("Agent's address")).toHaveStyle({ borderTopColor: c.warn });
    expect(screen.queryByText("✓")).toBeNull();
  });

  it("still says so after the field is cleared, rather than going quiet", async () => {
    draw(<AddressField />);
    const input = screen.getByLabelText("Agent's address");
    await userEvent.type(input, "0x1");
    await userEvent.clear(input);
    expect(input).toHaveValue("");
    expect(screen.getByText(NOT_AN_ADDRESS)).toBeInTheDocument();
  });

  it("a value that checks out is confirmed with a mark beside the label, and no warning", async () => {
    draw(<AddressField />);
    await userEvent.type(screen.getByLabelText("Agent's address"), GOOD);
    expect(screen.getByText("✓")).toBeInTheDocument();
    expect(screen.queryByText(NOT_AN_ADDRESS)).toBeNull();
  });

  it("an address is never capitalised, and a name is", () => {
    const { unmount } = draw(<AddressField />);
    expect(screen.getByLabelText("Agent's address")).toHaveAttribute("autocapitalize", "none");
    unmount();
    draw(<Field label="Name" value="" onChangeText={vi.fn()} />);
    expect(screen.getByLabelText("Name")).toHaveAttribute("autocapitalize", "words");
  });

  it("keeps a value when editing ends, which in a browser is the field losing focus", () => {
    const onDone = vi.fn();
    draw(<AddressField start={GOOD} onDone={onDone} />);
    fireEvent.blur(screen.getByLabelText("Agent's address"));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("stops at the length it is given", async () => {
    function Name() {
      const [value, setValue] = useState("");
      return <Field label="Name" value={value} onChangeText={setValue} maxLength={4} />;
    }
    draw(<Name />);
    await userEvent.type(screen.getByLabelText("Name"), "Scouting");
    expect(screen.getByLabelText("Name")).toHaveValue("Scou");
  });

  it("puts a shortcut beside the label, and keeps its explanation behind a question mark", async () => {
    draw(<Field label="Agent" value="" onChangeText={vi.fn()} hint="The address your agent shows." action={<Text>Scan</Text>} />);
    expect(screen.getByText("Scan")).toBeInTheDocument();
    expect(screen.queryByText("The address your agent shows.")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "About Agent. The address your agent shows." }));
    expect(screen.getByText("The address your agent shows.")).toBeInTheDocument();
  });
});
