import type { ArtifactEnvelope, ArtifactKind } from "./contracts.ts";
/** Deterministic JSON: sorted object keys, no whitespace, so equal state yields equal bytes on every device. */
export declare function canonicalJson(value: unknown): string;
/** Path segment safe on every filesystem and identical on every device; long or odd ids are hashed. */
export declare function safeSegment(value: string): string;
/**
 * Names are identical on every device: they derive from stable identity (document revision,
 * fact revision, lifecycle transition id), never from device-local commit versions or clocks.
 */
export declare function artifactName(kind: ArtifactKind, scopeId: string, key: string, ordinal: number | string, suffix: string): string;
export declare function envelope<Body>(kind: ArtifactKind, namespaceId: string, scopeId: string, version: number, body: Body): ArtifactEnvelope<Body>;
export declare function serialize(value: ArtifactEnvelope): string;
export type ParsedArtifact = {
    ok: true;
    envelope: ArtifactEnvelope;
} | {
    ok: false;
    reason: "corrupt" | "incompatible";
    detail: string;
};
/** Parses one artifact defensively: a torn write, foreign file or newer format is reported, never thrown. */
export declare function parseArtifact(text: string): ParsedArtifact;
export declare function assertNoSecrets(text: string): void;
