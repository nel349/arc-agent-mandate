/**
 * Asking before something that cannot be undone, in a browser.
 *
 * React Native's `Alert.alert` is the native dialog on iOS and Android, and on the web it is an
 * empty function: react-native-web ships `static alert() {}`. A screen that asked through it showed
 * nothing and did nothing in a browser, so Revoke on the web build was a button that never revoked.
 * The browser has its own dialog for exactly this, `window.confirm`, which blocks until answered.
 *
 * `ask` is passed in so the decision can be tested without a browser.
 */
export interface Question {
  readonly title: string;
  readonly message: string;
}

export function confirmInBrowser(
  question: Question,
  onConfirm: () => void,
  ask: (text: string) => boolean = (text) => globalThis.confirm(text),
): void {
  if (ask(`${question.title}\n\n${question.message}`)) onConfirm();
}
