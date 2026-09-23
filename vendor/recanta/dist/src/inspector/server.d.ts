import type { Access } from "../contracts.ts";
import type { SourceMetadata } from "../processing/contracts.ts";
import type { SqliteRecanta } from "../recanta.ts";
export interface InspectorOptions {
    access: Access;
    scopes: readonly string[];
    port?: number;
    correctionMetadata?: SourceMetadata;
}
export interface InspectorServer {
    url: string;
    close(): Promise<void>;
}
/** Explicitly started local UI with fixed trusted access and source identity. */
export declare function startInspector(store: SqliteRecanta, options: InspectorOptions): Promise<InspectorServer>;
