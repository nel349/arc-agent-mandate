/**
 * The QR encoder `qrcode-terminal` bundles, used to draw the agent's code as an image.
 *
 * Declared as narrowly as the terminal half in `qrcode-terminal.d.ts`: only what
 * `mcp/pairing-image.ts` calls.
 */
declare module "qrcode-terminal/vendor/QRCode/index.js" {
  export default class QRCode {
    constructor(typeNumber: number, errorCorrectLevel: number);
    addData(data: string): void;
    make(): void;
    getModuleCount(): number;
    isDark(row: number, col: number): boolean;
  }
}

declare module "qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel.js" {
  const levels: { readonly L: number; readonly M: number; readonly Q: number; readonly H: number };
  export default levels;
}
