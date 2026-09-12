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
   */
  shadow: {
    panel: {
      shadowColor: "#000000",
      shadowOpacity: 0.35,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 6,
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
   */
  type: {
    /** The one figure a screen is about: what an agent has left. */
    hero: { fontSize: 44, fontWeight: "700", letterSpacing: -1 },
    /**
     * An amount being typed, as Kuira's send wizard sets it: very large and very light, so the
     * number is the whole screen and still reads as something in progress rather than a total.
     */
    amountEntry: { fontSize: 60, fontWeight: "200", letterSpacing: -1 },
    largeTitle: { fontSize: 34, fontWeight: "700", letterSpacing: 0.4 },
    title: { fontSize: 22, fontWeight: "700", letterSpacing: -0.3 },
    headline: { fontSize: 17, fontWeight: "600" },
    body: { fontSize: 17, lineHeight: 22 },
    callout: { fontSize: 16, lineHeight: 21 },
    subheadline: { fontSize: 15, lineHeight: 20 },
    footnote: { fontSize: 13, lineHeight: 18 },
    caption: { fontSize: 12, lineHeight: 16 },
    /** Over a group of rows. The only uppercase left, and it earns it by being small. */
    section: { fontSize: 13, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase" },
    button: { fontSize: 17, fontWeight: "600" },
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
