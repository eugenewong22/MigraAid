/** Only the exact value emitted by the opt-in control grants storage consent. */
export function hasExplicitStorageConsent(value: unknown): boolean {
  return value === "true";
}
