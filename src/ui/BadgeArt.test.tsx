import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { draw } from "../test/draw.tsx";
import { BadgeArt } from "./BadgeArt.tsx";
import { cohortBadgeName } from "./badge-metadata.ts";

const ART = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#123456"/></svg>';

describe("a badge", () => {
  it("draws the picture the badge carries, named as the badge", () => {
    draw(<BadgeArt svg={ART} number={7} />);
    const badge = screen.getByLabelText(cohortBadgeName(7));
    expect(badge.querySelector("rect")).not.toBeNull();
    expect(badge).not.toHaveTextContent("#7");
  });

  it("without a picture still shows the number that was earned", () => {
    draw(<BadgeArt svg={null} number={42} />);
    const badge = screen.getByLabelText(cohortBadgeName(42));
    expect(badge).toHaveTextContent("#42");
    expect(badge.querySelector("svg")).toBeNull();
  });

  it("is drawn at the size it is asked for", () => {
    draw(<BadgeArt svg={null} number={1} size={64} />);
    const badge = screen.getByLabelText(cohortBadgeName(1));
    expect(badge.style.width).toBe("64px");
    expect(badge.style.height).toBe("64px");
  });
});
