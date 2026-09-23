import type { Evidence } from "../contracts.ts";
import type { ClaimRevision } from "../memory/contracts.ts";
import type { ProcessingRun, SourceMetadata } from "../processing/contracts.ts";
/**
 * Host storage adapter for portable artifacts. The kernel never touches a filesystem;
 * Obsidian hands this to its vault adapter, Node to a directory, tests to a Map.
 * Names are relative, "/"-separated and never contain machine-specific paths.
 * `write` should make the file appear atomically (temp file + rename) where the
 * platform allows; the checksum in every artifact detects a torn write regardless.
 */
export interface ArtifactStore {
    list(prefix: string): Promise<string[]>;
    read(name: string): Promise<string | null>;
    write(name: string, text: string): Promise<void>;
    remove(name: string): Promise<void>;
}
export interface PortableArtifact {
    name: string;
    text: string;
}
export type ArtifactKind = "evidence" | "run" | "fact" | "lifecycle";
/** Every artifact file is one envelope. `checksum` is the SHA-256 of the canonical body JSON. */
export interface ArtifactEnvelope<Body = unknown> {
    format: "recanta-artifact-v1";
    kind: ArtifactKind;
    engine: {
        name: string;
        version: string;
    };
    artifactFormat: number;
    schemaVersion: number;
    namespaceId: string;
    scopeId: string;
    /** Origin namespace commit version; orders replay and is not reused on import. */
    version: number;
    body: Body;
    checksum: string;
}
export interface EvidenceArtifact {
    evidence: Evidence & {
        payloadHash: string;
    };
    /** Host-authenticated source metadata. Runs travel in their own artifacts (`run` is kept for older files). */
    processing: {
        metadata: SourceMetadata;
        run: ProcessingRun | null;
    } | null;
}
/**
 * One processing run at a terminal state: extraction output, usage, candidate decisions.
 * A run changes state (failed, retried, completed); each state is its own immutable file,
 * and importing a later state replaces an earlier one.
 */
export interface RunArtifact {
    run: ProcessingRun;
}
export interface FactArtifact {
    revision: ClaimRevision;
    payloadHash: string;
}
export interface LifecycleArtifact {
    id: string;
    sourceId: string;
    evidenceId: string | null;
    kind: "deleted" | "restored" | "invalidated" | "positioned";
    reason: string | null;
    recordedAt: string;
}
export interface ExportRequest {
    scopes: readonly string[];
    /** Only rows committed after this namespace version; omit for everything. */
    afterVersion?: number;
}
export interface ExportResult {
    artifacts: PortableArtifact[];
    /** Highest namespace version covered; pass as `afterVersion` next time. */
    version: number;
    counts: Record<ArtifactKind, number>;
}
export type ImportSkipReason = "duplicate" | "pending" | "corrupt" | "incompatible" | "divergent" | "forbidden";
export interface ImportIssue {
    name: string;
    reason: ImportSkipReason;
    detail: string;
}
export interface ImportReport {
    applied: Record<ArtifactKind, number>;
    skipped: Record<ImportSkipReason, number>;
    issues: ImportIssue[];
    /** Artifacts waiting for a dependency that has not arrived yet; retry after the next delivery. */
    pending: string[];
    /** Restored processing runs that have no stored extraction output; only these need a provider. */
    needsProcessing: string[];
    version: number;
}
export interface SyncReport {
    exported: number;
    imported: ImportReport;
}
