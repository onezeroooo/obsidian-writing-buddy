/**
 * A rejection reason as an Error. Real errors pass through untouched so
 * `instanceof` checks upstream keep working; anything else is wrapped.
 */
export function asError(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value));
}
