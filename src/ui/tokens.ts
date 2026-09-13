/**
 * Structure. Everything here is the same in every theme.
 *
 * **Colour lives in `themes.ts`**, reached through `useTheme()`. The split is deliberate: a theme
 * that can change spacing or type size is a second layout in disguise, and the second one is
 * always the one nobody tested. A palette swaps; a layout does not.
 *
 * Sizes, spacing, radii and opacity go through here rather than being inlined in a `StyleSheet`.
 * It is easy to wave layout literals through as "just styling" — they are the same magic numbers
 * as anywhere else, and the second screen is where scattered values start disagreeing.
 */
export const tokens = {
  /** `hair` is the gap inside a two-line row, where anything larger reads as two separate things. */
  space: { hair: 2, tiny: 3, xs: 6, sm: 10, md: 12, base: 16, lg: 20, xl: 28 },

  /**
   * Depth, cast downward. Glass sits above its background rather than being painted onto it, and
   * without a shadow the translucency reads as a lighter patch of the same plane.
   *
   * **iOS only, and `elevation` is absent on purpose.** Android cannot cast this shadow under a
   * translucent fill without the fill picking it up. Measured at 420dpi: every card carried a
   * second, square-cornered rectangle sitting exactly on its own 16dp padding box, so a card read
   * as two nested boxes with the inner one lighter. Dropping `elevation` removes it — the step
   * across that edge falls from (3,4,7) to the (1,1,2) of the background gradient. Raising the
   * glass opacity had made it worse, which was the tell: it was the card's own fill, drawn twice,
   * not a stray view.
   *
   * Android takes its depth from tone instead, as Material does: the translucent fill lifts the
   * surface off the gradient and the lit top edge in `Surface` says where the light lands. Both are
   * already there, and neither needs a render node of its own.
   */
  shadow: {
    panel: {
      shadowColor: "#000000",
      shadowOpacity: 0.35,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
    },
  },
  radius: {
    sm: 3,
    md: 10,
    lg: 16,
    /** Fully rounded. Large enough that any control shorter than it becomes a pill. */
    pill: 999,
  },
  border: { hairline: 1 },

  /**
   * Type roles, named after Apple's text styles and sized at their default Dynamic Type size.
   *
   * **Words in the system font, data in mono.** Everything used to be uppercase Menlo, so a
   * heading, a field label, a button and a sentence all looked alike and nothing on a screen
   * ranked above anything else. Mono is now kept for what a person compares character by
   * character — an address, a hash — which is the same rule the web follows.
   *
   * React Native scales these with the reader's text size setting, so they are starting points
   * rather than fixed sizes. A layout that only works at the default size does not work.
   *
   * **Every role states its line height.** Seven did not, and a text node without one is handed the
   * font's own ascender and descender slack, which differs by platform, weight and glyph. That was
   * not a detail: it is why one card breathed differently on iOS and Android, why a section heading
   * sat hard against the edge of the surface holding it, and why the gaps between things measured
   * 57.1, 29.0, 16.4 and 10.3dp rather than landing on the scale above. A gap nobody chose is the
   * sum of three nobody looked at.
   *
   * The figures are Apple's own at the default size, because this scale was already Apple's — body
   * 17/22, callout 16/21, subheadline 15/20, footnote 13/18 and caption 12/16 match their table
   * exactly. So the missing ones are filled in from the same table rather than from a ratio somebody
   * liked the look of. Note the leading tightens as the type grows: 1.38 at 13pt down to 1.21 at
   * 34pt. Large text wants proportionally less room between lines, not more.
   */
  type: {
    /**
     * The one figure a screen is about: what an agent has left.
     *
     * Larger than Apple's largest style, so its leading continues their curve rather than copying a
     * row from it — about 1.18 here. Safe this tight because it is one line of tabular figures, and
     * digits carry no descenders to clip.
     */
    hero: { fontSize: 44, lineHeight: 52, fontWeight: "700", letterSpacing: -1 },
    /**
     * An amount being typed, as Kuira's send wizard sets it: very large and very light, so the
     * number is the whole screen and still reads as something in progress rather than a total.
     *
     * Tighter again, about 1.15, for the same reason — and because at this size spare leading is
     * dead space above a number somebody is watching themselves type.
     */
    amountEntry: { fontSize: 60, lineHeight: 69, fontWeight: "200", letterSpacing: -1 },
    largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: "700", letterSpacing: 0.4 },
    title: { fontSize: 22, lineHeight: 28, fontWeight: "700", letterSpacing: -0.3 },
    headline: { fontSize: 17, lineHeight: 22, fontWeight: "600" },
    body: { fontSize: 17, lineHeight: 22 },
    callout: { fontSize: 16, lineHeight: 21 },
    subheadline: { fontSize: 15, lineHeight: 20 },
    footnote: { fontSize: 13, lineHeight: 18 },
    caption: { fontSize: 12, lineHeight: 16 },
    /**
     * Over a group of rows. The only uppercase left, and it earns it by being small.
     *
     * Footnote's metrics, which is what iOS sets its own grouped-list headings at. Without the line
     * height this was the heading that sat flush against the top edge of the card beneath it.
     */
    section: { fontSize: 13, lineHeight: 18, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase" },
    /** Body's metrics: a button's label is a sentence, set at the same rhythm as one. */
    button: { fontSize: 17, lineHeight: 22, fontWeight: "600" },
    /** An address or a hash. Small enough that a whole address fits one line at the phone's width. */
    data: { fontFamily: "Menlo", fontSize: 13, lineHeight: 18 },
  },

  size: {
    /**
     * The smallest comfortable touch target, per Apple's guidance. Anything a finger has to hit
     * gets at least this, including rows that look tall enough already — "tall enough" depends on
     * the content, and content changes.
     */
    tapTarget: 44,

    /** Round controls, named by where they appear rather than by their number. */
    control: {
      /**
       * The `?` beside a field label. Apple's smallest visible control, so it does not compete with
       * the label it sits by; `hitSlop` takes the touch area to 44.
       */
      hint: 28,
      /** A navigation bar button. */
      header: 40,
      /**
       * A selectable pill in a choice row. Below the 44pt target on purpose — a row of pills at
       * full target height towers over the fields beside it — so every pill carries `hitSlop`
       * back up to 44.
       */
      pill: 34,
      /** A full-width preset under an amount, Kuira's button height, so a thumb cannot miss it. */
      preset: 54,
    },

    /** The bar a full-screen step draws for itself: back, title and one action, as Kuira's wizard does. */
    topBar: 56,

    /**
     * How much of a round control its glyph fills.
     *
     * One ratio rather than a size per control: a glyph that fills the same fraction everywhere
     * looks like one family, and an icon sized independently of its container is how a button
     * ends up looking half empty.
     */
    glyphScale: 0.6,

    /** The colour swatches in the appearance picker. */
    swatch: { width: 9, height: 22 },
    /** The selected-option mark, and its filled centre. */
    mark: 18,
    markDot: 8,
    /** A disclosure chevron on a row. */
    chevron: 16,
    /** A glyph before a button's title. */
    buttonIcon: 20,

    /**
     * The mark, where it appears.
     *
     * The stroke is a fraction of the diameter rather than a fixed width, so the ring keeps its
     * weight if it is ever drawn larger — a fixed stroke on a bigger circle reads as a thin hoop,
     * which is how a mark stops looking like the same mark.
     */
    ring: { row: 44, card: 52, review: 120, hero: 176, welcome: 120, strokeRatio: 0.12 },
  },
  opacity: { disabled: 0.4, pressed: 0.7 },
  font: {
    /** For `type.data` and nowhere else. */
    mono: "Menlo",
    /**
     * Figures that change while you watch them.
     *
     * The allowance re-reads the chain every ten seconds. With proportional digits each update
     * changes the number's width and the whole row twitches; tabular figures are all one width,
     * so only the glyphs change.
     */
    tabular: ["tabular-nums"],
  },
} as const;
