import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ARC_MAINNET, ARC_TESTNET, MONAD_TESTNET } from "@kuiralabs/mandate-core";
import { Amount } from "../arc/amount.ts";
import { draw } from "../test/draw.tsx";
import { AllowanceCard, type AllowanceFace } from "./AllowanceCard.tsx";

const AGENT = "0x68c91fb4f4e7f0236fd68c7d2605b5740787b17e";
const PAYEE = "0xc831b6e4414E064F7713A3b6017be4a1Eb9F5E9b";

const TYPED: AllowanceFace = {
  network: ARC_TESTNET, limit: Amount.parse("20"), agent: AGENT, name: null, ends: null, askedBy: null, payees: [], calls: [],
  spoken: "This agent can spend up to 20.00 USDC with no end date.",
};

describe("an allowance, as the card the wallet issues", () => {
  it("is read as one sentence, and shows the figure, its coin and the network", () => {
    draw(<AllowanceCard face={TYPED} />);
    const card = screen.getByLabelText(TYPED.spoken);
    expect(card).toHaveTextContent("Allowance");
    expect(card).toHaveTextContent("Arc testnet");
    expect(screen.getByText("20.00")).toBeInTheDocument();
    expect(screen.getByText("USDC")).toBeInTheDocument();
  });

  it("prints the agent as a fingerprint, two lines of five groups", () => {
    draw(<AllowanceCard face={TYPED} />);
    expect(screen.getByText("68C9 1FB4 F4E7 F023 6FD6")).toBeInTheDocument();
    expect(screen.getByText("8C7D 2605 B574 0787 B17E")).toBeInTheDocument();
  });

  it("says Never for an allowance with no end, and leaves out what was not given", () => {
    draw(<AllowanceCard face={TYPED} />);
    expect(screen.getByText("Never")).toBeInTheDocument();
    for (const label of ["Name", "Asked by", "Pays", "Calls"]) expect(screen.queryByText(label)).toBeNull();
  });

  it("prints everything an app's code asked for", () => {
    draw(<AllowanceCard face={{
      ...TYPED, network: MONAD_TESTNET, limit: Amount.parse("0.01"), name: "Runner", ends: "11 Oct", askedBy: "A test app",
      payees: [PAYEE], calls: [{ contract: PAYEE, functions: ["join(uint256)", "submit(uint256,bytes32)"] }],
      spoken: "Runner can spend up to 0.01 MON until 11 Oct.",
    }} />);
    expect(screen.getByText("Runner")).toBeInTheDocument();
    expect(screen.getByText("A test app")).toBeInTheDocument();
    expect(screen.getByText("C831 B6E4 … 5E9B")).toBeInTheDocument();
    expect(screen.getByText("join, submit")).toBeInTheDocument();
    expect(screen.getByText("on C831 B6E4 … 5E9B")).toBeInTheDocument();
    expect(screen.getByText("11 Oct")).toBeInTheDocument();
    expect(screen.getByText("0.01")).toBeInTheDocument();
    expect(screen.getByText("MON")).toBeInTheDocument();
    expect(screen.getByText("Monad testnet")).toBeInTheDocument();
  });

  it("counts payees rather than listing them when there are several", () => {
    draw(<AllowanceCard face={{ ...TYPED, payees: [PAYEE, AGENT, "0x0000000000000000000000000000000000000001"] }} />);
    expect(screen.getByText("3 addresses only")).toBeInTheDocument();
  });

  it("names mainnet on its tag, so a card for real money is not mistaken for a test one", () => {
    draw(<AllowanceCard face={{ ...TYPED, network: ARC_MAINNET }} />);
    expect(screen.getByLabelText(TYPED.spoken)).toHaveTextContent(/Arc mainnet/i);
  });
});
