/** Caller provides the read transaction; inspection repeats all normal access checks. */
export class MemoryInspector {
    #db;
    #store;
    constructor(db, store) { this.#db = db; this.#store = store; }
    context(access, request, context, plan) {
        const body = JSON.parse(context.text);
        const equal = (a, b) => a.scopeId === b.scopeId && a.subjectId === b.subjectId && a.predicate === b.predicate;
        return { context, plan, body, facts: body.facts.map(fact => {
                const key = { scopeId: fact.scopeId, subjectId: fact.subjectId, predicate: fact.predicate };
                const planned = plan.facts.find(item => equal(item.key, key));
                return { key, selection: request.requiredFacts?.some(k => equal(k, key)) ? "required" : "discovered", score: planned?.score ?? null,
                    history: this.#store.claimHistory(access, { ...key, afterRevision: Math.max(0, fact.revision - 20), limit: 20 }), hasEarlierHistory: fact.revision > 20 };
            }) };
    }
    evidence(access, evidenceId) {
        const evidence = this.#store.evidence(access, evidenceId);
        const rows = this.#db.prepare("SELECT id FROM processing_runs WHERE namespace_id=? AND scope_id=? AND evidence_id=? ORDER BY rowid DESC LIMIT 21").all(access.namespaceId, evidence.scopeId, evidenceId);
        return { evidence, current: this.#store.sourceHead(access, evidence.scopeId, evidence.sourceId, { includeDeleted: true }).id === evidence.id, runs: rows.slice(0, 20).map(row => this.#store.processingStatus(access, String(row.id))), hasMoreRuns: rows.length > 20 };
    }
}
