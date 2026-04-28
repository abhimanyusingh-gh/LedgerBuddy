export class MissingActiveClientOrgError extends Error {
  constructor(public readonly requestPath: string) {
    super(`Missing active clientOrgId for realm-scoped request: ${requestPath}`);
    this.name = "MissingActiveClientOrgError";
  }
}
