import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ARC_MAINNET, MONAD_TESTNET } from "@kuiralabs/mandate-core";
import PreviewScreen from "../../app/preview.tsx";
import { draw, endAnimations } from "../test/draw.tsx";

/**
 * The preview draws every control in every state without a wallet, which is how most states are
 * ever seen. Drawn here whole, so a control that throws in some state fails a test before a person
 * opens the page to find it blank.
 */
describe("the preview screen", () => {
  it("draws every control without an error", () => {
    const errors = vi.spyOn(console, "error");
    draw(<PreviewScreen />);
    expect(screen.getByText("Network picker")).toBeInTheDocument();
    // React reports a thrown render, a missing key and a bad prop through console.error. One is
    // react-native-svg's own: it writes a rotation's centre as `transform-origin`, which React names.
    const ours = errors.mock.calls.filter(([first, second]) => !(/Invalid DOM property/.test(String(first)) && second === "transform-origin"));
    expect(ours).toEqual([]);
    errors.mockRestore();
  });

  it("its network picker changes the network shown", async () => {
    draw(<PreviewScreen />);
    const pill = screen.getByRole("button", { name: new RegExp(`Network: ${MONAD_TESTNET.name}`) });
    await userEvent.click(pill);
    await userEvent.click(screen.getByRole("radio", { name: new RegExp(`${ARC_MAINNET.name}, Real money`) }));
    endAnimations();
    expect(screen.getByRole("button", { name: new RegExp(`Network: ${ARC_MAINNET.name}, Real money`) })).toBeInTheDocument();
  });
});
