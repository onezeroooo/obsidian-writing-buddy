import { countChars } from "../util/text";

/** Stable content identity used to detect that a cited source has changed. */
export function contentRevision(text: string): string {
	let left = 14695981039346656037n;
	let right = 1099511628211n;
	const mask = (1n << 64n) - 1n;
	for (const char of text) {
		const point = BigInt(char.codePointAt(0) ?? 0);
		left = ((left ^ point) * 1099511628211n) & mask;
		right = ((right ^ (point + 0x9e3779b97f4a7c15n)) * 14029467366897019727n) & mask;
	}
	return `${countChars(text)}:${left.toString(36)}:${right.toString(36)}`;
}

export function isContentRevision(value: unknown): value is string {
	return typeof value === "string" && /^\d{1,12}:[a-z0-9]{1,20}:[a-z0-9]{1,20}$/u.test(value);
}
