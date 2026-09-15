/**
 * Identifier and timestamp helpers.
 *
 * Identifiers are filename-safe because sessions are stored one-per-file.
 */

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

function randomBytes(count: number): Uint8Array {
	const out = new Uint8Array(count);
	const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
	if (cryptoObj?.getRandomValues) {
		cryptoObj.getRandomValues(out);
		return out;
	}
	for (let i = 0; i < count; i += 1) {
		out[i] = Math.floor(Math.random() * 256);
	}
	return out;
}

/** A short, lowercase, filename-safe random identifier. */
export function randomId(length = 16): string {
	const bytes = randomBytes(length);
	let out = "";
	for (let i = 0; i < length; i += 1) {
		out += ALPHABET[bytes[i] % ALPHABET.length];
	}
	return out;
}

export function createSessionId(): string {
	return `s_${randomId(20)}`;
}

export function createMessageId(): string {
	return `m_${randomId(16)}`;
}

export function createRequestId(): string {
	return `r_${randomId(20)}`;
}

export function createConnectionId(): string {
	return `conn_${randomId(20)}`;
}

export function createEditId(): string {
	return `e_${randomId(16)}`;
}

export function nowIso(): string {
	return new Date().toISOString();
}

/**
 * Rejects anything that could escape the conversations directory. Session files
 * are named directly from these ids, so this is a path-traversal guard.
 */
export function isSafeSessionId(value: string): boolean {
	return /^[a-z0-9_-]{1,64}$/.test(value);
}
