/** Policy is deterministic and cannot acquire approval from provider output. */
export function reconcile(candidate, run, state, origins, evidenceVersion, minimumConfidence, source = { sourceId: "", sourceVersion: 0 }) {
    const n = candidate.normalization;
    const key = n.subjectId && n.predicate ? { scopeId: run.scopeId, subjectId: n.subjectId, predicate: n.predicate } : null;
    const decision = { candidate, acceptance: "unresolved", relation: "unresolved", reason: "", authority: { actorId: run.metadata.actorId ?? null, source: run.metadata.actorType, approval: run.metadata.authority === "approved" }, key, claimId: null, targetIds: [] };
    const unresolved = (reason) => { decision.reason = reason; return { decision, write: null }; };
    if (!key || n.value === null || n.ambiguities.length)
        return unresolved(n.ambiguities.join(" ") || "No comparable scalar slot.");
    const quote = candidate.raw.span.quote;
    if (/\b(considering|propose|maybe|might|should|would|said|says|not|never)\b|["“”‘’]|考虑|建议|不是|不再/iu.test(quote))
        return unresolved("Source contains a proposal, quotation or negation marker.");
    if (/\b(today|tomorrow|yesterday|next|last|before|after|currently)\b|下个月|明天|昨天|之前/iu.test(quote))
        return unresolved("Source contains an unsupported temporal qualifier.");
    if (/\b(for|in) (production|project \w+|US|v\d+)\b/iu.test(quote))
        return unresolved("Source contains an unsupported scope qualifier.");
    if (candidate.raw.intent === "correct" && !/\b(actually|correction|corrected|instead)\b|其实|更正/iu.test(quote))
        return unresolved("No explicit correction marker in the source span.");
    if (candidate.raw.intent === "retract" && !/\b(retract|withdraw|forget)\b|撤回/iu.test(quote))
        return unresolved("No explicit retraction marker in the source span.");
    if (candidate.raw.assertionMode !== "assertion")
        return unresolved(`Source mode is ${candidate.raw.assertionMode}; no automatic acceptance.`);
    if (candidate.raw.confidence !== null && candidate.raw.confidence < minimumConfidence)
        return unresolved("Extraction confidence is below policy threshold.");
    if (run.metadata.derivedFromEvidenceId)
        return unresolved("Derived source remains provenance, not independent support.");
    if (run.metadata.actorType === "tool" && run.metadata.toolOutcome !== "succeeded")
        return unresolved("A tool attempt, failure or unknown outcome cannot establish successful state.");
    const personal = n.subjectId === `actor:${run.metadata.actorId}`;
    const direct = run.metadata.actorType === "person" && !!run.metadata.actorId;
    if (!(direct && personal) && run.metadata.authority !== "approved")
        return unresolved("This source lacks authenticated authority for non-personal state.");
    if (state?.cardinality === "multiple")
        return unresolved("The automatic scalar policy cannot modify a multiple-value slot.");
    const active = state?.claims ?? [];
    const asserted = active.filter(c => c.mode === "asserted");
    // Commit order is knowledge order for unpositioned sources only; positioned sources compete by position.
    if (!source.positioned && asserted.some(c => (origins.get(c.id)?.evidenceVersion ?? 0) > evidenceVersion))
        return unresolved("Older evidence cannot replace or compete with newer accepted state during delayed processing.");
    const owned = (claim) => { const origin = origins.get(claim.id); return origin && origin.actorId === run.metadata.actorId && evidenceVersion >= origin.evidenceVersion && (!origin.approved || run.metadata.authority === "approved"); };
    const intent = candidate.raw.intent;
    let targets = [];
    if (intent === "correct" || intent === "retract") {
        if (!asserted.length || !asserted.every(owned))
            return unresolved("Correction target is missing, newer, or has a different authority.");
        targets = asserted.map(c => c.id);
    }
    // A newer revision of the same source replaces what its own earlier revisions asserted: the
    // document edit is the supersession. Stale support from any other source still needs a correction.
    const revised = asserted.filter(c => !c.evidenceCurrent);
    const ownRevisions = revised.filter(c => { const sources = origins.get(c.id)?.sources ?? []; return sources.length > 0 && sources.every(item => item.sourceId === source.sourceId && item.sourceVersion < source.sourceVersion); });
    if (intent === "assert" && revised.length > ownRevisions.length)
        return unresolved("Previous support was revised; an explicit correction is required.");
    const supported = intent === "assert" ? asserted.find(claim => claim.value === n.value && claim.evidenceCurrent) : undefined;
    if (supported) {
        // Equal value: this revision joins the claim's support. The active-claim set does not grow,
        // but the claim now cites every revision that states it, so a host can place it in each.
        decision.acceptance = "accepted";
        decision.relation = "support";
        decision.reason = "Equivalent current memory already exists; this source was linked as additional support.";
        decision.claimId = supported.id;
        const write = supported.evidenceIds.includes(run.evidenceId) ? null : { ...key, operationId: candidate.id, expectedRevision: state?.revision ?? 0, cardinality: "single", evidenceIds: [run.evidenceId], action: { kind: "support", targetIds: [supported.id] } };
        return { decision, write };
    }
    if (intent === "assert" && ownRevisions.length)
        targets = ownRevisions.map(c => c.id);
    const competing = asserted.filter(c => !targets.includes(c.id));
    decision.acceptance = "accepted";
    decision.relation = intent === "retract" ? "retraction" : intent === "correct" ? "correction" : targets.length ? "supersession" : competing.length ? "conflict" : "add";
    decision.reason = decision.relation === "conflict" ? "Competing assertion retained; no winner selected." : decision.relation === "supersession" ? "A newer revision of the same source replaced its earlier assertion." : "Source-backed direct statement passed the default authority policy.";
    decision.targetIds = targets;
    decision.claimId = intent === "retract" ? null : candidate.id;
    const assertion = { value: n.value, mode: "asserted", evidenceIds: [run.evidenceId] };
    const action = intent === "retract" ? { kind: "retract", targetIds: targets } : intent === "correct" ? { kind: "replace", targetIds: targets, reason: "correction", assertion } : targets.length ? { kind: "replace", targetIds: targets, reason: "supersession", assertion } : { kind: "add", assertion };
    return { decision, write: { ...key, operationId: candidate.id, expectedRevision: state?.revision ?? 0, cardinality: "single", evidenceIds: [run.evidenceId], action } };
}
