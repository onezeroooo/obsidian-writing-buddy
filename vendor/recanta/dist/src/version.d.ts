/** Package version; a test keeps it equal to package.json. Not a release decision. */
export declare const ENGINE_NAME = "recanta";
export declare const ENGINE_VERSION = "0.1.0";
/** Portable artifact format. Bumped only when older engines could misread a file. */
export declare const ARTIFACT_FORMAT = 1;
export interface EngineInfo {
    engine: {
        name: string;
        version: string;
    };
    schemaVersion: number;
    artifactFormat: number;
    /** Device-local lexical projection identity: tokenizer fingerprint plus acceleration structure. */
    indexVersion: string;
    acceleration: "fts5" | "scan";
    capabilities: readonly string[];
}
export declare const CAPABILITIES: readonly string[];
export declare const engineDescription: (indexVersion: string, acceleration: "fts5" | "scan") => EngineInfo;
