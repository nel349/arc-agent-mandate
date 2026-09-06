import type { ReactNode } from "react";
import { Button } from "./Button.tsx";
import { ChoiceRow, type Choice } from "./ChoiceRow.tsx";
import { Field } from "./Field.tsx";
import { Label } from "./Label.tsx";
import { Note } from "./Note.tsx";
import { Surface } from "./Surface.tsx";
import type { GrantProblems } from "./grant-terms.ts";

/**
 * The form for giving an agent an allowance.
 *
 * A component rather than markup inside the screen, for one practical reason: the screen only
 * renders it once a wallet exists, so on a simulator without a passkey there was no way to look
 * at it. The states worth reviewing — a filled address, a custom amount, a live summary — were
 * three steps behind a ceremony, which is how a form ends up shipping with defects nobody saw.
 * Now the catalogue renders the same component the product does, and neither can drift from the
 * other.
 *
 * Presentational: every value and every handler comes in. The reading of those values, and the
 * decision about whether they can be granted, belongs to `readGrantTerms`.
 */
export function GrantForm({
  agent, onAgent, amount, onAmount, days, onDays,
  amountCustom, onAmountCustom, daysCustom, onDaysCustom,
  amounts, windows, problems, summary, canGrant, busy, onGrant, notice, resetKey, addressAction,
}: {
  readonly agent: string;
  readonly onAgent: (next: string) => void;
  readonly amount: string;
  readonly onAmount: (next: string) => void;
  readonly days: string;
  readonly onDays: (next: string) => void;
  readonly amountCustom: boolean;
  readonly onAmountCustom: () => void;
  readonly daysCustom: boolean;
  readonly onDaysCustom: () => void;
  readonly amounts: readonly Choice<string>[];
  readonly windows: readonly Choice<string>[];
  readonly problems: GrantProblems;
  /** The sentence above the button, or `null` while the form cannot be read. */
  readonly summary: string | null;
  readonly canGrant: boolean;
  readonly busy: boolean;
  readonly onGrant: () => void;
  /** Why granting is unavailable for a reason outside the form, such as a missing plugin. */
  readonly notice?: string | null;
  /**
   * Changing this remounts the address field, clearing the "touched" state that makes it explain
   * itself. A grant clears the form, and the field cannot tell that from the person clearing it —
   * without this, a successful grant left the form complaining that the empty address is invalid.
   */
  readonly resetKey: number;
  /** Shown beside the address label — the scan shortcut, when the screen offers one. */
  readonly addressAction?: ReactNode;
}) {
  return (
    <Surface>
      <Label>Give an Agent an Allowance</Label>

      <Field
        key={resetKey}
        label="Agent address"
        value={agent}
        onChangeText={onAgent}
        placeholder="0x…"
        hint="Ask your agent for its address — it prints one on first run."
        problem={problems.agent}
        confirmed={problems.agent === null && agent.length > 0}
        action={addressAction}
      />

      <ChoiceRow
        label="Amount · USDC"
        hint="The total this agent may ever spend. It cannot exceed this, whatever it is asked to buy."
        options={amounts}
        selected={amount}
        onSelect={onAmount}
        custom={{
          active: amountCustom,
          onSelect: onAmountCustom,
          children: (
            <Field
              label="Amount"
              value={amount}
              onChangeText={onAmount}
              placeholder="10"
              keyboardType="decimal-pad"
              problem={problems.amount}
            />
          ),
        }}
      />

      <ChoiceRow
        label="Expires after"
        hint="After this the allowance stops working on its own, with nothing to remember."
        options={windows}
        selected={days}
        onSelect={onDays}
        custom={{
          label: "Custom",
          active: daysCustom,
          onSelect: onDaysCustom,
          children: (
            <Field
              label="Days"
              value={days}
              onChangeText={onDays}
              placeholder="7"
              keyboardType="decimal-pad"
              problem={problems.days}
            />
          ),
        }}
      />

      {summary !== null && <Note>{summary}</Note>}

      <Button tier="solid" title="Grant Allowance" onPress={onGrant} busy={busy} disabled={!canGrant} />

      {/* Inside the form, where the dimmed button is, rather than as a paragraph above it. */}
      {notice != null && <Note tone="warn">{notice}</Note>}
    </Surface>
  );
}
