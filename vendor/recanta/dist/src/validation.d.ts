import type { Access, FeedRequest, MemoryEvent } from "./contracts.ts";
export declare const MAX_CONTENT_BYTES = 1048576;
export declare function id(value: unknown): asserts value is string;
export declare function integer(value: unknown, min?: number, max?: number): asserts value is number;
export declare function plainObject<T>(value: T, fields?: readonly string[]): asserts value is T & Record<string, unknown>;
export declare function ids(value: unknown, allowEmpty?: boolean): asserts value is readonly string[];
export declare function validateAccess(access: Access): void;
export declare function scopes(access: Access, requested: readonly string[], mode: "read" | "write"): string[];
export declare function canonicalEvent(event: MemoryEvent): MemoryEvent;
export declare function feed(access: Access, request: FeedRequest): {
    selected: string[];
    after: number;
    limit: number;
};
export declare function hash(value: string): string;
