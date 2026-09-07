/**
 * `qrcode-terminal` ships no types and has no `@types` package.
 *
 * Only the one function this connector calls is declared, rather than a guess at the whole library:
 * a declaration wider than its use is a promise nobody checked.
 */
declare module "qrcode-terminal" {
  interface Options {
    readonly small?: boolean;
  }
  export function generate(text: string, options: Options, callback: (code: string) => void): void;
  export function generate(text: string, callback: (code: string) => void): void;
  const qrcode: { generate: typeof generate };
  export default qrcode;
}
