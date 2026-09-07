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

  /**
   * True when the provider refused this *model* rather than this request — a
   * free model gated to approved apps, say. Nothing about the key or the
   * timing changes it, so the model is dropped for good and the run moves to
   * the next candidate rather than stopping.
   */
  readonly modelUnavailable: boolean;

  constructor(message: string, transient = false, modelUnavailable = false) {
    super(message);
    this.transient = transient;
    this.modelUnavailable = modelUnavailable;
  }
}
