import { check } from "../errors.js";
import { sha256Hex } from "../hash.js";
import { ARTIFACT_FORMAT, ENGINE_NAME, ENGINE_VERSION } from "../version.js";
import { SCHEMA_VERSION } from "../store/schema.js";
/** Deterministic JSON: sorted object keys, no whitespace, so equal state yields equal bytes on every device. */
export function canonicalJson(value) {
    return JSON.stringify(sort(value));
}
function sort(value) {
    if (Array.isArray(value))
        return value.map(sort);
    if (value !== null && typeof value === "object") {
        const out = {};
        for (const key of Object.keys(value).sort()) {
            const item = value[key];
            if (item !== undefined)
                out[key] = sort(item);
        }
        return out;
    }
    return value;
}
/** Path segment safe on every filesystem and identical on every device; long or odd ids are hashed. */
export function safeSegment(value) {
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value) && !/^\.+$/.test(value) ? value : "h-" + sha256Hex(value).slice(0, 24);
}
const pad = (value, width) => String(value).padStart(width, "0");
/**
 * Names are identical on every device: they derive from stable identity (document revision,
 * fact revision, lifecycle transition id), never from device-local commit versions or clocks.
 */
export function artifactName(kind, scopeId, key, ordinal, suffix) {
    const folder = kind === "evidence" ? "sources" : kind === "run" ? "runs" : kind === "fact" ? "facts" : "lifecycle";
    const stamp = typeof ordinal === "number" ? pad(ordinal, 10) : ordinal.replace(/[^0-9TZ]/g, "").slice(0, 24);
    return `${folder}/${safeSegment(scopeId)}/${safeSegment(key)}/${stamp ? `${stamp}-` : ""}${suffix}.json`;
}
export function envelope(kind, namespaceId, scopeId, version, body) {
    return { format: "recanta-artifact-v1", kind, engine: { name: ENGINE_NAME, version: ENGINE_VERSION }, artifactFormat: ARTIFACT_FORMAT, schemaVersion: SCHEMA_VERSION, namespaceId, scopeId, version, body, checksum: sha256Hex(canonicalJson(body)) };
}
export function serialize(value) { return canonicalJson(value) + "\n"; }
/** Parses one artifact defensively: a torn write, foreign file or newer format is reported, never thrown. */
export function parseArtifact(text) {
    let value;
    try {
        value = JSON.parse(text);
    }
    catch {
        return { ok: false, reason: "corrupt", detail: "Artifact is not valid JSON; possibly a torn write." };
    }
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return { ok: false, reason: "corrupt", detail: "Artifact is not an object." };
    const item = value;
    if (item.format !== "recanta-artifact-v1")
        return { ok: false, reason: "incompatible", detail: `Unknown artifact format ${String(item.format)}.` };
    if (typeof item.artifactFormat !== "number" || item.artifactFormat > ARTIFACT_FORMAT)
        return { ok: false, reason: "incompatible", detail: `Artifact format ${String(item.artifactFormat)} is newer than this engine supports (${ARTIFACT_FORMAT}); upgrade the engine.` };
    if (!["evidence", "run", "fact", "lifecycle"].includes(String(item.kind)))
        return { ok: false, reason: "incompatible", detail: `Unknown artifact kind ${String(item.kind)}.` };
    for (const field of ["namespaceId", "scopeId", "checksum"])
        if (typeof item[field] !== "string")
            return { ok: false, reason: "corrupt", detail: `Artifact ${field} is missing.` };
    if (typeof item.version !== "number" || !Number.isSafeInteger(item.version) || item.version < 1)
        return { ok: false, reason: "corrupt", detail: "Artifact version is missing." };
    if (item.body === null || typeof item.body !== "object")
        return { ok: false, reason: "corrupt", detail: "Artifact body is missing." };
    if (sha256Hex(canonicalJson(item.body)) !== item.checksum)
        return { ok: false, reason: "corrupt", detail: "Artifact checksum does not match its body; the file is truncated or altered." };
    return { ok: true, envelope: item };
}
export function assertNoSecrets(text) {
    // Portable files must never carry credentials or machine paths; the exporter only emits kernel rows, this is a tripwire.
    check(!/"(?:apiKey|api_key|authorization|password|token)"\s*:/iu.test(text), "INVALID_INPUT", "Refusing to export an artifact that appears to contain a credential field.");
}
