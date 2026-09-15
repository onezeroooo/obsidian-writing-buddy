/**
 * Lossless, local preparation for an explicitly requested whole-manuscript pass.
 *
 * This module deliberately stops before orchestration: it identifies the current
 * manuscript, captures one immutable view of its files, and divides that view
 * into bounded pieces. It never calls a model and never mutates the vault.
 */

import { countChars } from "../util/text";
import type { VaultReader } from "./types";
import {
	hasExplicitArchiveMetadata,
	isEligibleContextPath,
	isExplicitArchivePath,
	isWithinContextRoot,
	normaliseVaultPath,
} from "./eligibility";

export { hasExplicitArchiveMetadata, isExplicitArchivePath } from "./eligibility";

export const FULL_CORPUS_CHUNK_CHARS = 7_000;
export const FULL_CORPUS_BATCH_CHARS = 28_000;
export const FULL_CORPUS_BATCH_CHUNKS = 16;

export interface FullCorpusSnapshotProgress {
	completedFiles: number;
	totalFiles: number;
}

export interface FullCorpusOptions {
	/** Maximum code points in one citeable piece. */
	chunkChars?: number;
	/** Maximum code points in one model-sized batch. */
	batchChars?: number;
	/** Maximum pieces in one batch, independently of its character bound. */
	maxChunksPerBatch?: number;
	/** Content-free snapshot progress. */
	onProgress?: (progress: FullCorpusSnapshotProgress) => void;
	/** Cooperative cancellation checked before and after every saved-file read. */
	shouldCancel?: () => boolean;
	/** Standard cancellation source for callers that already own a controller. */
	signal?: AbortSignal;
}

/** Distinguishes an interrupted snapshot from an incomplete/failed snapshot. */
export class FullCorpusSnapshotCancelledError extends Error {
	constructor() {
		super("Full-corpus snapshot cancelled");
		this.name = "FullCorpusSnapshotCancelledError";
	}
}

export function isFullCorpusSnapshotCancelled(error: unknown): error is FullCorpusSnapshotCancelledError {
	return error instanceof FullCorpusSnapshotCancelledError;
}

export interface FullCorpusTarget {
	kind: "current-manuscript";
	/** Vault-relative directory; an empty string means the Vault root. */
	root: string;
	activeFilePath: string;
}

export interface FullCorpusFileSnapshot {
	path: string;
	/** Exact editor or saved text. Never normalised or trimmed. */
	text: string;
	revision: "editor" | "saved";
	/** Unicode code points, matching the rest of WritingBuddy's context accounting. */
	chars: number;
}

export interface FullCorpusReadFailure {
	path: string;
	reason: string;
}

export interface FullCorpusChunk {
	/** Stable snapshot-local evidence id, derived from path and file chunk ordinal. */
	id: string;
	path: string;
	revision: "editor" | "saved";
	/** Zero-based position among every chunk in natural manuscript order. */
	index: number;
	/** Zero-based position of the source file in the snapshot. */
	fileIndex: number;
	/** Zero-based position within the source file. */
	chunkIndex: number;
	/** Half-open Unicode code-point offsets in the exact source file. */
	startChar: number;
	endChar: number;
	chars: number;
	text: string;
}

export interface FullCorpusBatch {
	id: string;
	/** Zero-based batch position. */
	index: number;
	chars: number;
	chunks: readonly FullCorpusChunk[];
}

export interface FullCorpusSnapshot {
	target: Readonly<FullCorpusTarget>;
	/** Successfully captured files, in natural manuscript order. */
	files: readonly Readonly<FullCorpusFileSnapshot>[];
	/** Explicit historical/discarded files that were intentionally outside the target. */
	excludedFiles: readonly string[];
	/** Target files whose saved contents could not be captured. */
	readFailures: readonly Readonly<FullCorpusReadFailure>[];
	/** Paths not represented in chunks. Currently the failed-read paths. */
	uncoveredFiles: readonly string[];
	chunks: readonly Readonly<FullCorpusChunk>[];
	batches: readonly Readonly<FullCorpusBatch>[];
	/** Captured files plus failed reads; excluded historical files are not targets. */
	totalFiles: number;
	/** Exact code-point total of all successfully captured target files. */
	totalChars: number;
}

/** Persistable, content-free progress for a whole-manuscript operation. */
export interface FullCorpusCoverage {
	target: "current-manuscript";
	status: "complete" | "partial" | "degraded" | "failed" | "cancelled";
	includedFiles: number;
	totalFiles: number;
	includedChars: number;
	totalChars: number;
	completedBatches: number;
	/** Exact zero-based leaf indexes represented by this result. */
	completedBatchIndexes?: number[];
	totalBatches: number;
	reductionBatches: number;
	/** Planned reduction calls for the memo topology actually synthesized. */
	totalReductionBatches?: number;
	/** Whether synthesis was complete, partial, or recovered from terminal memos. */
	summaryStatus?: "complete" | "partial" | "degraded" | "failed";
	readFailures: number;
	uncoveredFiles: string[];
	/** Present for bounded orchestration runs; absent on older stored reports. */
	backendCalls?: number;
	maxBackendCalls?: number;
	deadlineMs?: number;
	limitReached?: "deadline" | "soft-deadline" | "backend-call-limit";
}

/**
 * Recognise only an explicit request for all manuscript text. Broad words such
 * as "全局" and "整体" intentionally do not count. Task/action guards live
 * in ContextPlanner, where rewrite and continue are known.
 */
export function isExplicitFullCorpusRequest(query: string): boolean {
	const normalised = query.normalize("NFKC");
	const chinese = /全文|全稿|整部(?:小说|作品)|整本小说|所有(?:的)?章节|全部(?:的)?章节|逐章(?:检查|审阅|审核|分析|通读|阅读)|通读(?:一遍)?全文|从头到尾/iu;
	const english = /\b(?:full|entire|whole)\s+(?:manuscript|novel)\b|\ball\s+chapters\b|\b(?:read|review|check)\s+(?:it\s+)?from\s+(?:the\s+)?(?:beginning|start)\s+to\s+(?:the\s+)?end\b/iu;
	if (!chinese.test(normalised) && !english.test(normalised)) return false;

	// A direct negation of the only whole-corpus phrase is not a request to do it.
	// This stays deliberately local so "不要只看局部，请通读全文" still opts in.
	const withoutNegated = normalised
		.replace(/(?:不要|不用|无需|不必|别)(?:再|去|做|进行|帮我|我)?\s*(?:看|读|检查|审阅|审核|分析|通读)?\s*(?:全文|全稿|整部(?:小说|作品)|整本小说|所有(?:的)?章节|全部(?:的)?章节|逐章(?:检查|审阅|审核|分析|通读|阅读)|从头到尾)/giu, "")
		.replace(/\b(?:do\s+not|don't|dont|no\s+need\s+to|not)\s+(?:(?:read|review|check)\s+)?(?:the\s+)?(?:(?:full|entire|whole)\s+(?:manuscript|novel)|all\s+chapters)\b/giu, "");
	return chinese.test(withoutNegated) || english.test(withoutNegated);
}

/** A whole-corpus request must stay bounded when its requested action writes prose. */
export function isFullCorpusWritingRequest(query: string): boolean {
	const normalised = query.normalize("NFKC");
	return /(?:重写|改写|润色|续写|接着写|继续写)(?:.{0,12})(?:全文|全稿|整部(?:小说|作品)|整本小说|所有(?:的)?章节|全部(?:的)?章节|逐章|从头到尾)|(?:全文|全稿|整部(?:小说|作品)|整本小说|所有(?:的)?章节|全部(?:的)?章节|逐章|从头到尾)(?:.{0,12})(?:重写|改写|润色|续写|接着写|继续写)/iu.test(normalised) ||
		/\b(?:rewrite|revise|polish|continue|complete)\b.{0,40}\b(?:(?:the\s+)?(?:full|entire|whole)\s+(?:manuscript|novel)|all\s+chapters)\b|\b(?:(?:the\s+)?(?:full|entire|whole)\s+(?:manuscript|novel)|all\s+chapters)\b.{0,40}\b(?:rewrite|revise|polish|continue|complete)\b/iu.test(normalised);
}

/**
 * Locate the nearest ancestor whose name identifies a manuscript directory.
 * If none does, the active file's immediate directory is the safest boundary.
 */
export function resolveCurrentManuscriptRoot(
	activeFilePath: string,
	markdownPaths: readonly string[],
): string {
	const active = normaliseVaultPath(activeFilePath);
	const directories = active.split("/").slice(0, -1);

	for (let index = directories.length - 1; index >= 0; index -= 1) {
		const compact = directories[index].normalize("NFKC").replace(/[\s._\-—–]+/gu, "").toLowerCase();
		if (compact.includes("正文当前版") || compact.includes("当前版") ||
			compact.includes("manuscript") || compact.includes("chapters")) {
			const root = directories.slice(0, index + 1).join("/");
			// Consult the supplied inventory so the parameter is not merely advisory.
			// The active file itself remains sufficient when an adapter's listing lags.
			if (markdownPaths.some((path) => isWithinContextRoot(normaliseVaultPath(path), root)) || isWithinContextRoot(active, root)) {
				return root;
			}
		}
	}

	return directories.join("/");
}

/**
 * Capture every target file before producing any chunks. The active file uses
 * the live editor buffer whenever one is available; every other file is read
 * from its saved Vault revision.
 */
export async function buildFullCorpusSnapshot(
	reader: VaultReader,
	options: FullCorpusOptions = {},
): Promise<FullCorpusSnapshot> {
	throwIfSnapshotCancelled(options);
	const activeValue = reader.activeFilePath();
	if (!activeValue) throw new Error("Cannot scan the current manuscript without an active file");
	const activeFilePath = normaliseVaultPath(activeValue);
	if (!/\.md$/iu.test(activeFilePath)) throw new Error("The active file is not Markdown");

	const inventory = reader.listMarkdownFiles().map(normaliseVaultPath);
	const root = resolveCurrentManuscriptRoot(activeFilePath, inventory);
	const allCandidates = [...new Set([...inventory, activeFilePath])];
	const candidates = allCandidates.filter((path) =>
		isEligibleContextPath(path, { scope: "full-current-manuscript", root, activeFilePath }),
	).sort(compareManuscriptPaths);
	const excludedFiles: string[] = [];
	for (const path of allCandidates) {
		if (isEligibleContextPath(path, {
			scope: "full-current-manuscript", root, activeFilePath, includeArchives: true,
		}) && isExplicitArchivePath(path)) excludedFiles.push(path);
	}
	const liveText = reader.activeFileText();
	const files: FullCorpusFileSnapshot[] = [];
	const readFailures: FullCorpusReadFailure[] = [];
	let completedFiles = 0;
	options.onProgress?.({ completedFiles, totalFiles: candidates.length });

	// Finish the complete read pass before chunking. This is the turn's frozen
	// view even if saved files or the editor change while later batches run.
	for (const path of candidates) {
		throwIfSnapshotCancelled(options);
		try {
			const useEditor = path === activeFilePath && liveText !== null;
			const revision = useEditor ? "editor" as const : "saved" as const;
			const text = useEditor ? liveText : await reader.read(path);
			throwIfSnapshotCancelled(options);
			if (hasExplicitArchiveMetadata(text)) {
				excludedFiles.push(path);
				continue;
			}
			files.push({ path, text, revision, chars: countChars(text) });
		} catch (error) {
			if (isFullCorpusSnapshotCancelled(error) || snapshotCancelled(options)) {
				throw isFullCorpusSnapshotCancelled(error) ? error : new FullCorpusSnapshotCancelledError();
			}
			readFailures.push({ path, reason: errorMessage(error) });
		} finally {
			completedFiles += 1;
			options.onProgress?.({ completedFiles, totalFiles: candidates.length });
		}
	}

	const chunkChars = positiveInteger(options.chunkChars, FULL_CORPUS_CHUNK_CHARS, "chunkChars");
	const batchChars = positiveInteger(options.batchChars, FULL_CORPUS_BATCH_CHARS, "batchChars");
	const maxChunks = positiveInteger(options.maxChunksPerBatch, FULL_CORPUS_BATCH_CHUNKS, "maxChunksPerBatch");
	const chunks: FullCorpusChunk[] = [];
	for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
		const fileChunks = chunkCorpusFile(files[fileIndex], Math.min(chunkChars, batchChars), fileIndex);
		for (const chunk of fileChunks) chunks.push({ ...chunk, index: chunks.length });
	}
	const frozenChunks = Object.freeze(chunks.map((chunk) => Object.freeze(chunk)));
	const batches = batchFullCorpusChunks(frozenChunks, { maxChars: batchChars, maxChunks });
	const uncoveredFiles = readFailures.map((failure) => failure.path);
	const totalChars = files.reduce((sum, file) => sum + file.chars, 0);

	return Object.freeze({
		target: Object.freeze({ kind: "current-manuscript", root, activeFilePath }),
		files: Object.freeze(files.map((file) => Object.freeze(file))),
		excludedFiles: Object.freeze([...excludedFiles].sort(compareManuscriptPaths)),
		readFailures: Object.freeze(readFailures.map((failure) => Object.freeze(failure))),
		uncoveredFiles: Object.freeze(uncoveredFiles),
		chunks: frozenChunks,
		batches,
		totalFiles: files.length + readFailures.length,
		totalChars,
	});
}

function snapshotCancelled(options: FullCorpusOptions): boolean {
	return options.signal?.aborted === true || options.shouldCancel?.() === true;
}

function throwIfSnapshotCancelled(options: FullCorpusOptions): void {
	if (snapshotCancelled(options)) throw new FullCorpusSnapshotCancelledError();
}

/** Split one exact file by Unicode code point, preferring a nearby line end. */
export function chunkCorpusFile(
	file: FullCorpusFileSnapshot,
	maxChars = FULL_CORPUS_CHUNK_CHARS,
	fileIndex = 0,
): readonly FullCorpusChunk[] {
	const limit = positiveInteger(maxChars, FULL_CORPUS_CHUNK_CHARS, "maxChars");
	if (!Number.isSafeInteger(fileIndex) || fileIndex < 0) throw new RangeError("fileIndex must be a non-negative safe integer");
	const codePoints = Array.from(file.text);
	const result: FullCorpusChunk[] = [];

	// Empty files still get one lossless, traceable piece, so file coverage can
	// never disappear merely because a chapter is intentionally blank.
	if (codePoints.length === 0) {
		return Object.freeze([Object.freeze(makeChunk(file, fileIndex, 0, 0, 0, ""))]);
	}

	let start = 0;
	while (start < codePoints.length) {
		let end = Math.min(start + limit, codePoints.length);
		if (end < codePoints.length) {
			const earliestNaturalBreak = start + Math.floor(limit * 0.6);
			for (let at = end - 1; at >= earliestNaturalBreak; at -= 1) {
				if (codePoints[at] === "\n") {
					end = at + 1;
					break;
				}
			}
		}
		const text = codePoints.slice(start, end).join("");
		result.push(makeChunk(file, fileIndex, result.length, start, end, text));
		start = end;
	}

	return Object.freeze(result.map((chunk) => Object.freeze(chunk)));
}

export interface FullCorpusBatchOptions {
	maxChars?: number;
	maxChunks?: number;
}

/** Pack already lossless chunks without trimming, merging, or truncating them. */
export function batchFullCorpusChunks(
	chunks: readonly FullCorpusChunk[],
	options: FullCorpusBatchOptions = {},
): readonly Readonly<FullCorpusBatch>[] {
	const maxChars = positiveInteger(options.maxChars, FULL_CORPUS_BATCH_CHARS, "maxChars");
	const maxChunks = positiveInteger(options.maxChunks, FULL_CORPUS_BATCH_CHUNKS, "maxChunks");
	const result: FullCorpusBatch[] = [];
	let pending: FullCorpusChunk[] = [];
	let pendingChars = 0;

	const flush = (): void => {
		if (pending.length === 0) return;
		const index = result.length;
		result.push(Object.freeze({
			id: `corpus-batch:${index + 1}`,
			index,
			chars: pendingChars,
			chunks: Object.freeze([...pending]),
		}));
		pending = [];
		pendingChars = 0;
	};

	for (const chunk of chunks) {
		if (!Number.isSafeInteger(chunk.chars) || chunk.chars < 0 || countChars(chunk.text) !== chunk.chars) {
			throw new Error(`Invalid full-corpus chunk ${chunk.id}`);
		}
		if (chunk.chars > maxChars) throw new RangeError(`Chunk ${chunk.id} exceeds the batch character limit`);
		if (pending.length >= maxChunks || (pending.length > 0 && pendingChars + chunk.chars > maxChars)) flush();
		pending.push(chunk);
		pendingChars += chunk.chars;
	}
	flush();

	return Object.freeze(result);
}

/** Defensive parser for persisted content-free whole-corpus progress. */
export function parseFullCorpusReport(value: unknown): FullCorpusCoverage | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	if (record.target !== "current-manuscript") return undefined;
	if (record.status !== "complete" && record.status !== "partial" && record.status !== "degraded" && record.status !== "failed" && record.status !== "cancelled") return undefined;
	const keys = [
		"includedFiles", "totalFiles", "includedChars", "totalChars",
		"completedBatches", "totalBatches", "reductionBatches", "readFailures",
	] as const;
	const numbers = {} as Record<typeof keys[number], number>;
	for (const key of keys) {
		const candidate = record[key];
		if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < 0) return undefined;
		numbers[key] = candidate;
	}
	if (!Array.isArray(record.uncoveredFiles) || !record.uncoveredFiles.every(isSafeVaultRelativePath)) {
		return undefined;
	}
	const uncoveredFiles = record.uncoveredFiles;
	let completedBatchIndexes: number[] | undefined;
	if (record.completedBatchIndexes !== undefined) {
		if (!Array.isArray(record.completedBatchIndexes) ||
			!record.completedBatchIndexes.every((index) =>
				typeof index === "number" && Number.isSafeInteger(index) && index >= 0 && index < numbers.totalBatches
			)) return undefined;
		completedBatchIndexes = record.completedBatchIndexes as number[];
		if (new Set(completedBatchIndexes).size !== completedBatchIndexes.length ||
			completedBatchIndexes.some((index, position) => position > 0 && index <= completedBatchIndexes![position - 1]) ||
			completedBatchIndexes.length !== numbers.completedBatches) return undefined;
	}
	if (new Set(uncoveredFiles).size !== uncoveredFiles.length ||
		numbers.includedFiles > numbers.totalFiles || numbers.includedChars > numbers.totalChars ||
		numbers.completedBatches > numbers.totalBatches || numbers.readFailures > numbers.totalFiles ||
		uncoveredFiles.length > numbers.totalFiles || numbers.readFailures > uncoveredFiles.length) {
		return undefined;
	}
	if (record.status === "complete" && (
		numbers.includedFiles !== numbers.totalFiles || numbers.includedChars !== numbers.totalChars ||
		numbers.completedBatches !== numbers.totalBatches || numbers.readFailures !== 0 || uncoveredFiles.length !== 0 ||
		(completedBatchIndexes !== undefined && completedBatchIndexes.some((index, position) => index !== position))
	)) {
		return undefined;
	}
	if (record.status === "partial" && numbers.completedBatches === numbers.totalBatches) return undefined;
	if (record.status === "degraded" && numbers.completedBatches !== numbers.totalBatches && record.limitReached !== "soft-deadline") return undefined;
	const optionalNumbers = ["backendCalls", "maxBackendCalls", "deadlineMs", "totalReductionBatches"] as const;
	for (const key of optionalNumbers) {
		const candidate = record[key];
		if (candidate !== undefined && (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < 0)) {
			return undefined;
		}
	}
	if (record.backendCalls !== undefined && record.maxBackendCalls !== undefined &&
		(record.backendCalls as number) > (record.maxBackendCalls as number)) return undefined;
	if (record.backendCalls !== undefined && record.maxBackendCalls === undefined) return undefined;
	if (record.maxBackendCalls !== undefined && record.deadlineMs === undefined) return undefined;
	if (typeof record.totalReductionBatches === "number" && numbers.reductionBatches > record.totalReductionBatches) return undefined;
	if (record.summaryStatus !== undefined && record.summaryStatus !== "complete" && record.summaryStatus !== "partial" &&
		record.summaryStatus !== "degraded" && record.summaryStatus !== "failed") return undefined;
	if (record.status === "complete" && record.summaryStatus !== undefined && record.summaryStatus !== "complete") return undefined;
	if (record.status === "partial" && record.summaryStatus !== undefined && record.summaryStatus !== "partial") return undefined;
	if (record.status === "degraded" && record.summaryStatus !== undefined && record.summaryStatus !== "degraded") return undefined;
	if (record.limitReached !== undefined && record.limitReached !== "deadline" && record.limitReached !== "soft-deadline" && record.limitReached !== "backend-call-limit") {
		return undefined;
	}
	if (record.limitReached !== undefined && record.status !== "failed" && record.status !== "partial" && record.status !== "degraded") return undefined;
	if (record.status === "partial" && record.limitReached !== "soft-deadline") return undefined;
	if (record.limitReached === "deadline" && record.deadlineMs === undefined) return undefined;
	if (record.limitReached === "backend-call-limit" && (
		record.backendCalls === undefined || record.maxBackendCalls === undefined || record.backendCalls !== record.maxBackendCalls
	)) return undefined;
	return Object.freeze({
		target: "current-manuscript",
		status: record.status,
		includedFiles: numbers.includedFiles,
		totalFiles: numbers.totalFiles,
		includedChars: numbers.includedChars,
		totalChars: numbers.totalChars,
		completedBatches: numbers.completedBatches,
		...(completedBatchIndexes ? { completedBatchIndexes: [...completedBatchIndexes] } : {}),
		totalBatches: numbers.totalBatches,
		reductionBatches: numbers.reductionBatches,
		...(typeof record.totalReductionBatches === "number" ? { totalReductionBatches: record.totalReductionBatches } : {}),
		...(typeof record.summaryStatus === "string" ? { summaryStatus: record.summaryStatus } : {}),
		readFailures: numbers.readFailures,
		uncoveredFiles: [...uncoveredFiles],
		...(typeof record.backendCalls === "number" ? { backendCalls: record.backendCalls } : {}),
		...(typeof record.maxBackendCalls === "number" ? { maxBackendCalls: record.maxBackendCalls } : {}),
		...(typeof record.deadlineMs === "number" ? { deadlineMs: record.deadlineMs } : {}),
		...(record.limitReached === "deadline" || record.limitReached === "soft-deadline" || record.limitReached === "backend-call-limit"
			? { limitReached: record.limitReached } : {}),
	});
}

/** Alias matching the persisted field name used by ContextBuildReport. */
export const parseFullCorpusCoverage = parseFullCorpusReport;

/** Numeric-aware path order keeps 第2章 before 第10章 without changing text. */
export function compareManuscriptPaths(left: string, right: string): number {
	const leftParts = normaliseVaultPath(left).split("/");
	const rightParts = normaliseVaultPath(right).split("/");
	const length = Math.min(leftParts.length, rightParts.length);
	for (let index = 0; index < length; index += 1) {
		const compared = naturalSegmentCompare(leftParts[index], rightParts[index]);
		if (compared !== 0) return compared;
	}
	return leftParts.length - rightParts.length;
}

function makeChunk(
	file: FullCorpusFileSnapshot,
	fileIndex: number,
	chunkIndex: number,
	startChar: number,
	endChar: number,
	text: string,
): FullCorpusChunk {
	return {
		id: `corpus:${encodeURIComponent(file.path)}:${chunkIndex + 1}`,
		path: file.path,
		revision: file.revision,
		index: chunkIndex,
		fileIndex,
		chunkIndex,
		startChar,
		endChar,
		chars: endChar - startChar,
		text,
	};
}

function naturalSegmentCompare(left: string, right: string): number {
	const leftOrdinal = manuscriptOrdinal(left);
	const rightOrdinal = manuscriptOrdinal(right);
	if (leftOrdinal && rightOrdinal && leftOrdinal.family === rightOrdinal.family && leftOrdinal.number !== rightOrdinal.number) {
		return leftOrdinal.number - rightOrdinal.number;
	}
	if (leftOrdinal && !rightOrdinal) return -1;
	if (!leftOrdinal && rightOrdinal) return 1;

	const tokens = (value: string): string[] => value.normalize("NFKC").toLowerCase().split(/(\d+)/u).filter(Boolean);
	const a = tokens(left);
	const b = tokens(right);
	for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
		if (a[index] === b[index]) continue;
		if (/^\d+$/u.test(a[index]) && /^\d+$/u.test(b[index])) {
			const aNumber = BigInt(a[index]);
			const bNumber = BigInt(b[index]);
			if (aNumber !== bNumber) return aNumber < bNumber ? -1 : 1;
		}
		const compared = a[index].localeCompare(b[index], "zh-CN", { sensitivity: "base" });
		if (compared !== 0) return compared;
	}
	return a.length - b.length || left.localeCompare(right, "zh-CN", { sensitivity: "variant" });
}

function manuscriptOrdinal(segment: string): { family: string; number: number } | null {
	const stem = segment.normalize("NFKC").replace(/\.md$/iu, "").trim();
	if (/^(?:楔子|引子|序章)(?:\s|[-—_：:]|$)/u.test(stem)) return { family: "chapter", number: -1 };
	if (/^(?:尾声|终章)(?:\s|[-—_：:]|$)/u.test(stem)) return { family: "chapter", number: Number.MAX_SAFE_INTEGER - 1 };
	const leading = /^第\s*([零〇一二三四五六七八九十百千万两\d]+)\s*(卷|部|章|节|回)/u.exec(stem);
	const trailing = /^(卷|部|章|节|回)\s*([零〇一二三四五六七八九十百千万两\d]+)/u.exec(stem);
	const familyToken = leading?.[2] ?? trailing?.[1];
	const numberToken = leading?.[1] ?? trailing?.[2];
	if (!familyToken || !numberToken) return null;
	const number = /^\d+$/u.test(numberToken) ? Number(numberToken) : chineseInteger(numberToken);
	if (number === null || !Number.isSafeInteger(number)) return null;
	return { family: familyToken === "卷" || familyToken === "部" ? "volume" : "chapter", number };
}

function chineseInteger(value: string): number | null {
	const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
	const units: Record<string, number> = { 十: 10, 百: 100, 千: 1_000, 万: 10_000 };
	let total = 0;
	let section = 0;
	let digit = 0;
	for (const character of value) {
		if (character in digits) {
			digit = digits[character];
			continue;
		}
		const unit = units[character];
		if (!unit) return null;
		if (unit === 10_000) {
			section = (section + digit) * unit;
			total += section;
			section = 0;
		} else {
			section += (digit || 1) * unit;
		}
		digit = 0;
	}
	return total + section + digit;
}

function isSafeVaultRelativePath(value: unknown): value is string {
	if (typeof value !== "string" || value.length === 0 || value.trim() !== value) return false;
	// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
	if (/[\\\u0000-\u001f\u007f-\u009f]/u.test(value) || value.startsWith("/") || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)) return false;
	return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
	if (value === undefined) return fallback;
	if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
	return value;
}

function errorMessage(error: unknown): string {
	if (error instanceof Error && error.message.length > 0) return error.message;
	return typeof error === "string" && error.length > 0 ? error : "Unknown read failure";
}
