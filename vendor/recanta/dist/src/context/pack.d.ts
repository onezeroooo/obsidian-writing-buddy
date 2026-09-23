import type { ContextBody, ContextResult, ContextSource } from "./contracts.ts";
import type { SearchSnapshot } from "../retrieval/contracts.ts";
/** Whole passages only; required facts and framing are never silently truncated. */
export declare function packContext(body: ContextBody, candidates: ContextSource[], maxBytes: number, snapshot: SearchSnapshot): ContextResult;
