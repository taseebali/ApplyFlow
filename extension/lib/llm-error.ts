/**
 * Lives on its own so both the client and the response-parsing helpers can
 * throw it without importing each other in a cycle.
 */
export class LlmError extends Error {}
