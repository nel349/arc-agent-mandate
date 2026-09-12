# The mark

A ring, drawn part-way round. The full circle is a limit and the drawn part is what is gone, which
is the whole product in one shape.

Unusually for a mark, **both extremes mean something**. An untouched allowance and an exhausted one
are the two states somebody opens the app to tell apart, and they are opposite pictures rather than
two similar ones. That is why the mark is a ring at a fraction rather than a ring: it is the
product's one figure, drawn.

The fraction here is a third. Enough to read as *part* spent at a glance, and not so much that it
looks like a warning.

## Everything in this directory is generated

```bash
node --experimental-transform-types scripts/brand.ts
```

Nothing here is hand-drawn or exported from a design tool, and nothing should be edited in place: the
next run overwrites it. The stroke ratio comes from `src/ui/tokens.ts` and the colours from the
Machine palette in `src/ui/themes.ts` — the same values `ArcRing` draws with on screen. Change the
ring in the app and every file below changes with it. That is the point: a brand directory whose
contents were exported once is a brand directory that is wrong a month later.

The maze draws the same geometry from its own copy of the rule, in `arc-maze/src/web/brand.ts`.
Neither repository can import the other, so what they share is the shape and the palette.

## What is here

| | |
|---|---|
| `mark.svg` | the ring alone, transparent, no ground. The one to reach for first |
| `icon.svg` | the ring on the Machine ground, square |
| `icon/icon-*.png` | the square icon, opaque. `1024` is the master and carries **no alpha channel**, which the App Store requires |
| `mark/mark-*.png` | the ring alone, transparent, for putting on somebody else's background |
| `android/adaptive-foreground.png` | the ring inside Android's safe zone, transparent |
| `android/adaptive-monochrome.png` | the same, as one ink, for Android's themed icons |

`app.json` names `icon/icon-1024.png` and both Android layers, so the app and this directory cannot
disagree. Prefer the SVGs anywhere a vector will do.

Each PNG size exists because something asks for it at that size — the App Store, a Play Store
listing, a launcher density, a favicon. `scripts/brand.ts` says which beside each number. A size
nothing asks for is a file nobody can ever decide to delete.

## The palette

| Role | | Where |
|---|---|---|
| ground | `#12110F` | behind the mark, and Android's adaptive background |
| allowed | `#7AA6D8` | the part of the ring still to spend |
| spent | `#EAE7DE` | the part that is gone |

The spent arc turns `#E8874A` in the app when an allowance is nearly out. The mark never uses that
colour: it is reserved for a live warning, and a logo that spends it has nothing left to warn with.

## Android's adaptive icon

Android hands the launcher a 108dp square and lets it cut whatever shape it likes out of the middle
72dp — a circle, a squircle, a teardrop, depending on the phone. Anything outside that is clipped.

So the foreground draws the ring at 41% of the canvas, inside the 67% that survives every mask, with
clearance on all sides. The background is a flat colour rather than an image: one less file, and
nothing to fall out of step with the palette.

The **monochrome** layer is for Android 13's themed icons, where the launcher throws the colours away
and tints whatever alpha is left with the wallpaper's. A flat silhouette would turn the mark into a
plain hoop and lose what it says, so the two arcs are told apart by how solid they are instead of by
hue, and the shape survives the tinting.
