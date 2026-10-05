/**
 * An address the way a key's fingerprint is printed: upper case, in groups of four.
 *
 * Forty characters run together cannot be compared by eye; ten groups of four can, against the
 * address an agent shows on the laptop, the way people have always checked a key against its owner.
 */

const GROUP = 4;
/** Ten groups make an address; five to a line, two lines. */
const GROUPS_PER_LINE = 5;

const groupsOf = (address: string): string[] =>
  (address.replace(/^0x/i, "").toUpperCase().match(new RegExp(`.{1,${GROUP}}`, "g")) ?? []);

/** The whole fingerprint, as two lines of five groups. */
export function fingerprintLines(address: string): readonly string[] {
  const groups = groupsOf(address);
  const lines: string[] = [];
  for (let at = 0; at < groups.length; at += GROUPS_PER_LINE) lines.push(groups.slice(at, at + GROUPS_PER_LINE).join(" "));
  return lines;
}

/** Enough of it to tell one from another on a single line: the first two groups and the last. */
export function shortFingerprint(address: string): string {
  const groups = groupsOf(address);
  return groups.length <= 3 ? groups.join(" ") : `${groups[0]} ${groups[1]} … ${groups[groups.length - 1]}`;
}
