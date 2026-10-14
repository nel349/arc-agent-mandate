# Network logos

Each network's own logo, exactly as its owner publishes it. Nothing here is redrawn, recoloured or cropped: both owners' rules forbid it, and a logo that is almost right is worse than a dot.

| File | What it is | Where it comes from |
|---|---|---|
| `arc.svg` | Arc's network icon, from Circle's Arc logo kit (`Arc Network Icon/Arc_network.svg`) | https://www.circle.com/pressroom#brandkit, the Arc logos download |
| `monad.svg` | Monad's token mark (`Token.svg`) | https://monad.xyz/brand-and-media-kit |

Arc's logo may be used by a project building on Arc, which this is, and must not suggest a partnership or be more prominent than the app's own name (https://www.arc.io/brand-guidelines-and-partner-toolkit). Fetched on 14 October 2026.

The app draws them from `src/ui/network-logos.ts`, which carries each file's text as it is here. `src/ui/network-logos.test.ts` fails if the two ever differ, so replacing a logo means replacing the file here and the text there together.
