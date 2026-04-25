/**
 * Standalone API error types. Extracted from `client.ts` (which pulls in
 * `import.meta.env`) so consumers — and tests — can import the error type
 * without booting the full axios instance.
 */
export class MissingActiveClientOrgError extends Error {
  constructor(public readonly requestPath: string) {
    super(`Missing active clientOrgId for realm-scoped request: ${requestPath}`);
    this.name = "MissingActiveClientOrgError";
  }
}
