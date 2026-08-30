/**
 * Lives on its own so both the client and the response-parsing helpers can
 * throw it without importing each other in a cycle.
 */
export class LlmError extends Error {
  /**
   * True when the request could plausibly succeed if simply sent again: a
   * saturated provider, an overloaded free endpoint, a rate limit. A rejected
   * key or an unknown model never is, and retrying those only wastes time.
   */
  readonly transient: boolean;

  constructor(message: string, transient = false) {
    super(message);
    this.transient = transient;
  }
}
