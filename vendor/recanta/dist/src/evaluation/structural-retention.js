import { check } from "../errors.js";
/** Evaluation-only structural check. It does not judge entailment, truth or semantic equivalence. */
export function evaluateStructuralRetention(items, requirements) {
    check(Array.isArray(items) && Array.isArray(requirements), "INVALID_INPUT", "Invalid structural retention input.");
    const checks = requirements.map(requirement => {
        check(requirement.id.length > 0 && requirement.sourceId.length > 0 && requirement.fragment.length > 0, "INVALID_INPUT", "Invalid structural retention requirement.");
        const normalizedFragment = requirement.fragment.normalize("NFKC").toLowerCase();
        const matching = items.filter(item => item.citation.sourceId === requirement.sourceId);
        const fragmentRetained = matching.some(item => item.text.normalize("NFKC").toLowerCase().includes(normalizedFragment));
        const forbiddenAbsent = requirement.forbiddenFragment === undefined || matching.every(item => !item.text.normalize("NFKC").toLowerCase().includes(requirement.forbiddenFragment.normalize("NFKC").toLowerCase()));
        return { id: requirement.id, kind: requirement.kind, passed: matching.length > 0 && fragmentRetained && forbiddenAbsent, matchingCitation: matching.length > 0, fragmentRetained, forbiddenAbsent };
    });
    return { passed: checks.every(item => item.passed), checks };
}
