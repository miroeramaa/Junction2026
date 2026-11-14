/** Only deliberately written messages from this error are safe to show in the UI. */
export class ComparisonResearchError extends Error {
  constructor(message: string, public readonly status = 502, public readonly stopQueue = false) {
    super(message);
    this.name = "ComparisonResearchError";
  }
}
