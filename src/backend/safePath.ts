import type { ContextDocumentPayload, TurnPayload } from "./AIBackend";

/**
 * Deliberately generic: an unsafe value may itself contain a private local
 * path, so it must never be interpolated into the error surfaced to the user.
 */
import { t } from "../i18n";

/** A function so the sentence follows the locale; both the throw and every
 * identity comparison call it, so equality still holds within a session. */
export function unsafeVaultPathMessage(): string {
	return t("backend.unsafeVaultPath");
}

const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
const EMBEDDED_URI = /(?:^|[^\p{L}\p{N}])(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|(?:file|obsidian):)/iu;
const WINDOWS_ABSOLUTE = /[A-Za-z]:\//u;
const UNIX_ABSOLUTE_TOKEN = /(?:^|[^\p{L}\p{N}_.-])\/(?=[^/\s])/u;
const TRAVERSAL_TOKEN = /(?:^|[/\s([{"'=])\.\.(?=\/)|(?:^|\/)\.\.$/u;
const EVIDENCE_PREFIX = /^\[S[1-9]\d*\] /u;
const EVIDENCE_LABEL = /^\[S[1-9]\d*\] (.+)（([^（）]+)）$/u;
const EVIDENCE_HEADING_SEPARATOR = " · ";
const PARENTHESIZED_LABEL = /^（[^（）]+）$/u;

/**
 * True only for an already-canonical Obsidian Vault path.
 *
 * This function never cleans up its input. Normalising `../secret.md`, a URI,
 * or a machine-local absolute path would preserve the text under a false
 * provenance label, which is worse than refusing the request.
 */
export function isSafeVaultRelativePath(value: unknown): value is string {
	if (typeof value !== "string" || value.length === 0 || value.trim() !== value) return false;
	if (hasUnsafeBasicSyntax(value)) return false;
	if (value.startsWith("/") || URI_SCHEME.test(value)) return false;

	return value.split("/").every((segment) =>
		segment.length > 0 &&
		segment.trim() === segment &&
		segment !== "." &&
		segment !== "..",
	);
}

/**
 * `context.documents[].path` is usually a Vault path, but citation evidence
 * intentionally makes it an opaque label such as
 * `[S1] chapters/a.md · heading（kind）`. Validate the embedded path while
 * retaining the exact label the evidence/citation layer generated.
 */
export function isSafeDocumentPathLabel(value: unknown): value is string {
	if (typeof value !== "string" || value.length === 0 || value.trim() !== value) return false;
	if (hasUnsafeBasicSyntax(value) || EMBEDDED_URI.test(value) || WINDOWS_ABSOLUTE.test(value) ||
		TRAVERSAL_TOKEN.test(value)) return false;

	// Anything that claims to be an evidence label must satisfy that grammar.
	// Otherwise it could evade the leading-path check merely by adding `[S1] `.
	if (EVIDENCE_PREFIX.test(value)) {
		const match = EVIDENCE_LABEL.exec(value);
		if (!match) return false;
		const body = match[1];
		const kind = match[2];
		const candidates = evidencePathCandidates(body);
		return candidates.some(({ path, heading }) =>
			isSafeVaultRelativePath(path) &&
			isSafeOpaqueLabelPart(kind) &&
			(heading === undefined || isSafeOpaqueLabelPart(heading)),
		);
	}

	// Citation/full-corpus control documents use a parenthesized opaque label.
	// Any other value is a real path. Extensionless Vault files remain valid.
	if (PARENTHESIZED_LABEL.test(value)) return isSafeOpaqueLabelPart(value.slice(1, -1));
	return isSafeVaultRelativePath(value);
}

/** Assert every path-shaped value before an adapter constructs its HTTP body. */
export function assertSafeTurnPayloadPaths(
	payload: Pick<TurnPayload, "currentFile" | "selection" | "documents">,
): void {
	void snapshotSafeTurnPayloadPaths(payload);
}

/**
 * Copy provenance-bearing values once, then validate that same snapshot. This
 * closes the gap a stateful getter or Proxy could otherwise create between a
 * successful check and later transport serialization.
 */
export function snapshotSafeTurnPayloadPaths(
	payload: Pick<TurnPayload, "currentFile" | "selection" | "documents">,
): { currentFile?: string; selectionFilePath?: string; documents: ContextDocumentPayload[] } {
	const currentFile = payload.currentFile;
	const selection = payload.selection;
	const selectionFilePath = selection?.filePath;
	const sourceDocuments = payload.documents;
	if (sourceDocuments !== undefined && !Array.isArray(sourceDocuments)) failUnsafePath();
	const documents = (sourceDocuments ?? []).map((document) => {
		if (typeof document !== "object" || document === null) failUnsafePath();
		const path = document.path;
		const text = document.text;
		if (!isSafeDocumentPathLabel(path)) failUnsafePath();
		return { path, text };
	});

	if (currentFile !== undefined && !isSafeVaultRelativePath(currentFile)) failUnsafePath();
	if (selection !== undefined && !isSafeVaultRelativePath(selectionFilePath)) failUnsafePath();
	return {
		...(currentFile !== undefined ? { currentFile } : {}),
		...(selectionFilePath !== undefined ? { selectionFilePath } : {}),
		documents,
	};
}

function isSafeOpaqueLabelPart(value: string): boolean {
	return value.length > 0 && value.trim() === value && !hasUnsafeEmbeddedPathSyntax(value);
}

/**
 * A legal Vault filename can itself contain ` · `. Try each separator as the
 * path/heading boundary (plus the headingless form) instead of splitting at
 * the first occurrence and rejecting a valid file.
 */
function evidencePathCandidates(body: string): Array<{ path: string; heading?: string }> {
	const candidates: Array<{ path: string; heading?: string }> = [{ path: body }];
	let separator = body.indexOf(EVIDENCE_HEADING_SEPARATOR);
	while (separator >= 0) {
		candidates.push({
			path: body.slice(0, separator),
			heading: body.slice(separator + EVIDENCE_HEADING_SEPARATOR.length),
		});
		separator = body.indexOf(EVIDENCE_HEADING_SEPARATOR, separator + EVIDENCE_HEADING_SEPARATOR.length);
	}
	return candidates;
}

function hasUnsafeEmbeddedPathSyntax(value: string): boolean {
	return hasUnsafeBasicSyntax(value) ||
		EMBEDDED_URI.test(value) ||
		WINDOWS_ABSOLUTE.test(value) ||
		UNIX_ABSOLUTE_TOKEN.test(value) ||
		TRAVERSAL_TOKEN.test(value);
}

function hasUnsafeBasicSyntax(value: string): boolean {
	return value.trim() !== value || CONTROL_OR_FORMAT.test(value) || value.includes("\\");
}

function failUnsafePath(): never {
	throw new Error(unsafeVaultPathMessage());
}
