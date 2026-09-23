import { check } from "../errors.js";
import { id, integer, plainObject, scopes } from "../validation.js";
const ACTOR_TYPES = ["person", "assistant", "tool", "document"];
/** Promise-based facade keeps embedded and remote transports behaviorally aligned. */
export class EmbeddedMemoryClient {
    #engine;
    #access;
    #principal;
    #defaultSource;
    #allowedSources;
    #grantAuthority;
    constructor(engine, access, principal) {
        this.#engine = engine;
        this.#access = structuredClone(access);
        plainObject(principal, ["id", "source", "allowedSources", "grantAuthority"]);
        id(principal.id);
        check(principal.grantAuthority === undefined || typeof principal.grantAuthority === "boolean", "INVALID_INPUT", "Invalid principal authority policy.");
        this.#grantAuthority = principal.grantAuthority === true;
        if (principal.allowedSources !== undefined) {
            check(Array.isArray(principal.allowedSources) && principal.allowedSources.length > 0 && principal.allowedSources.every(type => ACTOR_TYPES.includes(type)), "INVALID_INPUT", "Invalid allowed source actor list.");
            this.#allowedSources = [...principal.allowedSources];
        }
        else
            this.#allowedSources = null;
        this.#defaultSource = this.#source(principal.source, true);
        this.#principal = structuredClone(principal);
    }
    /** Normal path: untrusted request data; source provenance and authority are the bound principal default. */
    async add(request) {
        return this.#persist(this.#defaultSource, request);
    }
    /**
     * Trusted host-only path: the trusted integration supplies per-write source provenance while
     * authentication and scopes stay client-bound. Provenance must be permitted by principal policy;
     * reconciliation authority is granted only when the principal explicitly allows it.
     */
    async addTrusted(source, request) {
        return this.#persist(this.#source(source, false), request);
    }
    #source(source, isDefault) {
        plainObject(source, ["actorId", "actorType", "authority"]);
        id(source.actorId);
        check(ACTOR_TYPES.includes(source.actorType), "INVALID_INPUT", "Invalid trusted source actor type.");
        check(isDefault || this.#allowedSources === null || this.#allowedSources.includes(source.actorType), "FORBIDDEN", "This principal may not attribute evidence to that source actor.");
        if (source.authority !== undefined) {
            check(source.authority === "approved" || source.authority === "observation", "INVALID_INPUT", "Invalid trusted authority.");
            check(source.authority !== "approved" || this.#grantAuthority, "FORBIDDEN", "This principal may not grant reconciliation authority.");
        }
        return { actorId: source.actorId, actorType: source.actorType, ...(source.authority === undefined ? {} : { authority: source.authority }) };
    }
    async #persist(source, request) {
        plainObject(request, ["idempotencyKey", "scope", "content", "source", "kind", "subjects", "occurredAt", "sourceMetadata", "processing"]);
        id(request.idempotencyKey);
        id(request.scope);
        plainObject(request.source, ["id", "version", "stream"]);
        id(request.source.id);
        integer(request.source.version, 1);
        if (request.source.stream !== undefined)
            id(request.source.stream);
        if (request.sourceMetadata !== undefined)
            plainObject(request.sourceMetadata, ["toolOutcome", "derivedFromEvidenceId", "timezone"]);
        if (request.processing !== undefined)
            plainObject(request.processing, ["defer", "expectedSnapshot"]);
        const receipt = await this.#engine.retain(this.#access, {
            streamId: request.source.stream ?? "memory-client",
            eventId: request.idempotencyKey,
            sourceId: request.source.id,
            sourceVersion: request.source.version,
            scopeId: request.scope,
            kind: request.kind ?? "message",
            content: request.content,
            subjectIds: request.subjects ?? [],
            metadata: { ...(request.sourceMetadata ?? {}), actorType: source.actorType, actorId: source.actorId, ...(source.authority === undefined ? {} : { authority: source.authority }) },
            ...(request.occurredAt === undefined ? {} : { occurredAt: request.occurredAt }),
        }, request.processing ?? {});
        return { id: receipt.evidenceId, processingId: receipt.processingId, version: receipt.version, duplicate: receipt.duplicate, readiness: receipt.readiness };
    }
    async search(request) {
        plainObject(request, ["query", "scopes", "maxBytes", "maxTokens", "maxEstimatedTokens", "limit", "consistency", "minVersion"]);
        check(request.consistency === undefined || request.consistency === "available" || request.consistency === "strict", "INVALID_INPUT", "Invalid consistency mode.");
        const result = this.#engine.recallContext(this.#access, {
            query: request.query,
            scopes: request.scopes,
            maxBytes: request.maxBytes ?? 16384,
            ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
            ...(request.maxEstimatedTokens === undefined ? {} : { maxEstimatedTokens: request.maxEstimatedTokens }),
            ...(request.limit === undefined ? {} : { sourceLimit: request.limit }),
            ...(request.minVersion === undefined ? {} : { minVersion: request.minVersion }),
            requireReady: request.consistency === "strict",
        });
        const context = JSON.parse(result.text);
        return { format: "recanta-memory-search-v1", context, contextText: result.text, bytes: result.bytes, version: context.version, snapshot: result.snapshot };
    }
    async get(evidenceId) { return this.#engine.evidence(this.#access, evidenceId); }
    async processing(processingId) { return this.#engine.processingStatus(this.#access, processingId); }
    async retry(processingId) { return this.#engine.retryProcessing(this.#access, processingId); }
    async inspect(evidenceId) {
        const item = this.#engine.inspectEvidence(this.#access, evidenceId);
        const keys = new Map(item.runs.flatMap(r => r.decisions.flatMap(d => d.key ? [[JSON.stringify(d.key), d.key]] : [])));
        return { ...item, facts: [...keys.values()].slice(0, 32).map(key => { const { snapshot: _, ...fact } = this.#engine.fact(this.#access, key); return fact; }) };
    }
    async list(request) {
        plainObject(request, ["scopes", "afterVersion", "limit", "history"]);
        check(request.history === undefined || typeof request.history === "boolean", "INVALID_INPUT", "Invalid history selection.");
        const limit = request.limit ?? 40;
        integer(limit, 1, 100);
        const rows = this.#engine.events(this.#access, { scopes: request.scopes, afterVersion: request.afterVersion ?? 0, limit });
        const items = [];
        for (const row of rows) {
            const item = await this.inspect(row.id);
            if (request.history || item.current)
                items.push(item);
        }
        return { items, nextVersion: rows.length === limit ? rows.at(-1).version : null, version: rows.at(-1)?.version ?? request.afterVersion ?? 0 };
    }
    async health(selected) {
        scopes(this.#access, selected, "read");
        const state = this.#engine.healthState(this.#access, selected);
        return { format: "recanta-health-v1", namespaceId: this.#access.namespaceId, scopes: selected, version: state.version, counts: state.counts, ready: state.ready, capabilities: ["source-list-v1", "source-inspect-v1", "source-revision-v1", "scoped-health-v1"] };
    }
}
