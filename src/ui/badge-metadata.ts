/**
 * What a badge says about itself, read from the address its `tokenURI` gives.
 *
 * The badge's picture is not a file somewhere: the maze serves metadata whose `image` is the whole
 * SVG, base64 inside a data URI. So the phone draws exactly what a wallet or a block explorer draws,
 * from one fetch, with nothing to keep in step by hand.
 *
 * Pure, so the parsing is tested against the real bytes the maze serves rather than hoped about on a
 * phone. Anything unexpected reads as "no picture" instead of throwing: a badge that will not draw
 * must still show its number, since the number is the thing that was earned.
 */

/**
 * What a badge is called when its own metadata cannot be read.
 *
 * The cohort's name is one fact about the badge, not three fallbacks written in three places.
 */
export const cohortBadgeName = (number: number): string => `Cohort Zero #${number}`;

export interface BadgeArt {
  /** As the badge names itself, for example "Cohort Zero #1". */
  readonly name: string;
  /** The picture, or `null` when the metadata carried none this phone can draw. */
  readonly svg: string | null;
}

const SVG_BASE64 = "data:image/svg+xml;base64,";
const SVG_PLAIN = "data:image/svg+xml,";

/**
 * The SVG inside a data URI, or `null`.
 *
 * `atob` rather than a Buffer: React Native has no Buffer, and Hermes has had `atob` since 0.74.
 * The art is ASCII, so the binary string it returns is the markup.
 */
export function svgFromDataUri(uri: string): string | null {
  if (uri.startsWith(SVG_BASE64)) {
    try {
      const svg = globalThis.atob(uri.slice(SVG_BASE64.length));
      return svg.includes("<svg") ? svg : null;
    } catch {
      return null;
    }
  }
  if (uri.startsWith(SVG_PLAIN)) {
    const svg = decodeURIComponent(uri.slice(SVG_PLAIN.length));
    return svg.includes("<svg") ? svg : null;
  }
  return null;
}

/** A badge's metadata, as the maze serves it, or `null` when the body is not that. */
export function readBadgeMetadata(body: unknown): BadgeArt | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const name = record["name"];
  if (typeof name !== "string" || name.length === 0) return null;
  const image = record["image"];
  return { name, svg: typeof image === "string" ? svgFromDataUri(image) : null };
}
