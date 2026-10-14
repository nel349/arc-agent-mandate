import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { draw, endAnimations } from "../test/draw.tsx";
import { ScanModal } from "./ScanModal.tsx";

/**
 * What can be drawn here is the screen for a build without the camera, which is what these tests are:
 * `expo-camera` is loaded behind a `require` guard, and Vitest's modules have no `require`, so the
 * guard finds no camera. The viewfinder, the permission screens and the torch need a camera, and
 * `expo-camera`'s web build needs a `Worker` jsdom does not have, so they are not drawn here.
 */
describe("the scanner, in a build without the camera", () => {
  it("draws nothing while closed", () => {
    draw(<ScanModal visible={false} onClose={vi.fn()} onScanned={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says scanning is unavailable, and why, and offers the way that works now", async () => {
    const onClose = vi.fn();
    draw(<ScanModal visible onClose={onClose} onScanned={vi.fn()} />);
    expect(screen.getByText(/This build does not include the camera, so scanning is unavailable/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Type the address instead" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes from the keyboard too, as the back button does on a phone", async () => {
    const onClose = vi.fn();
    draw(<ScanModal visible onClose={onClose} onScanned={vi.fn()} />);
    endAnimations();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("goes when its owner closes it", async () => {
    function Owner() {
      const [open, setOpen] = useState(true);
      return <ScanModal visible={open} onClose={() => setOpen(false)} onScanned={vi.fn()} />;
    }
    draw(<Owner />);
    endAnimations();
    await userEvent.click(screen.getByRole("button", { name: "Type the address instead" }));
    endAnimations();
    expect(screen.queryByText(/scanning is unavailable/)).toBeNull();
  });
});
