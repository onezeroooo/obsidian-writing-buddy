/**
 * Which manuscript file is which, across renames, moves and devices.
 *
 * Memory is keyed by a document id that outlives the path: a chapter renamed
 * from `卷03.md` to `第三卷.md` is the same chapter, and evidence retained
 * under it must stay valid. The id is derived from the path the document was
 * first seen at, so two devices that meet the same new file independently
 * agree on its id without talking to each other; after that the id travels in
 * the portable document record and the path is just an attribute.
 *
 * Order in the story is the other half of identity. A chapter's ordinal comes
 * from its frontmatter when the writer states one, and otherwise from the
 * natural sort of paths inside the manuscript scope — the same order the file
 * explorer shows. Ordinals are recomputed whenever the inventory changes, and
 * a change of ordinal is a change of story position that later filtering
 * relies on.
 */

import { fnv1a } from "./novelKinds";
import { frontmatterValue, stripFrontmatter } from "./chunking";

export type DocumentRole = "manuscript" | "canon";

export interface DocumentRecord {
	docId: string;
	path: string;
	role: DocumentRole;
	/** Content identity of the last processed revision; null until processed. */
	revision: string | null;
	/** Monotonic per document; every processed revision, position change or reinstatement takes a new one. */
	version: number;
	/** Zero-based order within the manuscript scope; null for canon and deleted documents. */
	ordinal: number | null;
	status: "active" | "deleted";
	/** Point-of-view character declared in frontmatter, if any. */
	pov: string | null;
	updatedAt: string;
}

/** Deterministic from the first-seen path: the same on every device. */
export function documentIdFor(path: string): string {
	const normalized = path.replace(/\\/gu, "/");
	return `d${fnv1a(normalized)}${fnv1a(normalized.split("").reverse().join(""))}`;
}

export function isDocumentId(value: unknown): value is string {
	return typeof value === "string" && /^d[0-9a-f]{16}$/u.test(value);
}

/** Frontmatter can pin a chapter's order; a stated number beats path order. */
export function declaredOrdinal(text: string): number | null {
	const value = frontmatterValue(stripFrontmatter(text).frontmatter, "ordinal");
	if (value === null) return null;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function declaredPov(text: string): string | null {
	return frontmatterValue(stripFrontmatter(text).frontmatter, "pov");
}

/**
 * Natural order: `卷2` before `卷10`, `第三卷` by code point. Digits inside a
 * segment compare numerically so zero-padding is not required of the writer.
 */
export function naturalCompare(left: string, right: string): number {
	const tokens = (value: string) => value.match(/\d+|\D+/gu) ?? [];
	const a = tokens(left), b = tokens(right);
	for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
		const x = a[index], y = b[index];
		if (x === undefined) return -1;
		if (y === undefined) return 1;
		const nx = /^\d+$/u.test(x), ny = /^\d+$/u.test(y);
		if (nx && ny) {
			const diff = Number(x) - Number(y);
			if (diff !== 0) return diff;
		} else if (x !== y) {
			return x < y ? -1 : 1;
		}
	}
	return 0;
}

/**
 * Assign ordinals to the active manuscript documents. Declared ordinals sort
 * first among themselves; undeclared documents follow in natural path order.
 * Returns the documents whose ordinal changed, which the lifecycle must
 * re-position in memory.
 */
export function assignOrdinals(
	records: readonly DocumentRecord[],
	declared: ReadonlyMap<string, number | null>,
): DocumentRecord[] {
	const active = records.filter((record) => record.role === "manuscript" && record.status === "active");
	const sorted = [...active].sort((left, right) => {
		const dl = declared.get(left.docId) ?? null, dr = declared.get(right.docId) ?? null;
		if (dl !== null && dr !== null && dl !== dr) return dl - dr;
		if (dl !== null && dr === null) return -1;
		if (dl === null && dr !== null) return 1;
		return naturalCompare(left.path, right.path);
	});
	const changed: DocumentRecord[] = [];
	sorted.forEach((record, ordinal) => {
		if (record.ordinal !== ordinal) {
			record.ordinal = ordinal;
			changed.push(record);
		}
	});
	return changed;
}

/**
 * A file that appeared with the exact content of a recently deleted one is
 * that document under a new path. Sync delivers a rename as delete-then-create
 * with no `oldPath`, and this is the only evidence it leaves.
 */
export function matchRenameByContent(
	records: readonly DocumentRecord[],
	revision: string,
	role: DocumentRole,
): DocumentRecord | null {
	const candidates = records.filter((record) => record.status === "deleted" && record.role === role && record.revision === revision);
	if (candidates.length !== 1) return null;
	return candidates[0];
}
