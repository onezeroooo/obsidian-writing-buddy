import { check, RecantaError } from "../errors.js";
import { hash, id, integer, plainObject } from "../validation.js";
import { utf8Length } from "../runtime.js";
import { normalize, NORMALIZER_VERSION, vocabulary } from "./normalize.js";
import { RuleBasedProvider } from "./providers.js";
import { completeCoverage, usage, validateOutput } from "./validation.js";
export class ProcessingCoordinator {
    fingerprint;
    provider;
    maxAttempts;
    #store;
    #runs;
    #aliases;
    #timeout;
    #inputBytes;
    #outputBytes;
    #outputTokens;
    #confidence;
    constructor(store, runs, options = {}) {
        plainObject(options, ["provider", "vocabulary", "maxAttempts", "timeoutMs", "maxInputBytes", "maxOutputBytes", "maxOutputTokens", "minimumConfidence"]);
        this.#store = store;
        this.#runs = runs;
        this.provider = options.provider ?? new RuleBasedProvider();
        id(this.provider.fingerprint);
        check(["rules", "model"].includes(this.provider.method) && typeof this.provider.extract === "function", "INVALID_INPUT", "Invalid extraction provider.");
        this.#aliases = vocabulary(options.vocabulary);
        this.maxAttempts = options.maxAttempts ?? 3;
        integer(this.maxAttempts, 1, 10);
        this.#timeout = options.timeoutMs ?? 30000;
        integer(this.#timeout, 1, 300000);
        this.#inputBytes = options.maxInputBytes ?? 32768;
        integer(this.#inputBytes, 1, 1048576);
        this.#outputBytes = options.maxOutputBytes ?? 65536;
        integer(this.#outputBytes, 1024, 262144);
        this.#outputTokens = options.maxOutputTokens ?? 4096;
        integer(this.#outputTokens, 1, 32768);
        this.#confidence = options.minimumConfidence ?? 0.8;
        check(Number.isFinite(this.#confidence) && this.#confidence >= 0 && this.#confidence <= 1, "INVALID_INPUT", "Invalid confidence threshold.");
        this.fingerprint = hash(JSON.stringify(["owned-memory-v1", NORMALIZER_VERSION, this.provider.fingerprint, this.provider.method, this.#aliases, this.maxAttempts, this.#timeout, this.#inputBytes, this.#outputBytes, this.#outputTokens, this.#confidence]));
    }
    async process(access, processingId) {
        const run = this.#runs.start(access, processingId, this.fingerprint, this.#timeout);
        if (run.status !== "processing")
            return run;
        const token = run.leaseToken;
        try {
            const evidence = this.#store.evidence(access, run.evidenceId);
            let output = run.output;
            if (!output) {
                check(utf8Length(evidence.content) <= this.#inputBytes, "INVALID_INPUT", "Source exceeds configured processing input limit; evidence remains durable.");
                const controller = new AbortController();
                let timer;
                try {
                    const response = await Promise.race([
                        this.provider.extract({ evidence: structuredClone(evidence), metadata: structuredClone(run.metadata), signal: controller.signal, maxOutputTokens: this.#outputTokens }),
                        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new RecantaError("NOT_READY", "Extraction timed out.")); }, this.#timeout); }),
                    ]);
                    const reported = usage(response.usage);
                    this.#runs.recordUsage(access, run.id, token, reported);
                    check(reported.outputTokens <= this.#outputTokens, "INVALID_INPUT", "Provider exceeded configured output tokens.");
                    output = completeCoverage(validateOutput(response.output, evidence.content, this.#outputBytes), evidence.content);
                    this.#runs.saveOutput(access, run.id, token, output);
                }
                finally {
                    if (timer !== undefined)
                        clearTimeout(timer);
                }
            }
            else if (output.coverage === undefined) {
                output = completeCoverage(output, evidence.content);
                this.#runs.saveOutput(access, run.id, token, output);
            }
            const candidates = output.candidates.map((raw, index) => normalize(raw, index, run, evidence, this.#aliases, this.provider.method));
            for (let attempt = 0; attempt < 3; attempt++) {
                const plan = this.#runs.plan(access, run.id, token, candidates, this.#confidence);
                try {
                    return this.#runs.publish(access, plan);
                }
                catch (error) {
                    if (!(error instanceof RecantaError && error.code === "VERSION_CONFLICT") || attempt === 2)
                        throw error;
                }
            }
            throw new Error("Publication retry limit exhausted.");
        }
        catch (error) {
            // Provider errors may contain credentials or source text; persist only bounded categories.
            const code = error instanceof RecantaError ? error.code : "PROCESSING_FAILURE";
            const failed = this.#runs.fail(access, run.id, token, { code, message: code === "INVALID_INPUT" ? "Processing input/output failed validation." : code === "STALE_SOURCE" ? "Source changed before publication." : "Processing failed; retry within the configured limit." });
            if (code === "STALE_SOURCE")
                return this.#runs.start(access, run.id, this.fingerprint, this.#timeout);
            return failed;
        }
    }
}
