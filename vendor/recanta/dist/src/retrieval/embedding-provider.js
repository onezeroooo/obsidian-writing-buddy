import { check } from "../errors.js";
import { hash, integer } from "../validation.js";
import { text } from "../processing/validation.js";
import { decodeUtf8 } from "../runtime.js";
/** Explicit OpenAI-compatible embeddings endpoint. No environment discovery. */
export class HttpEmbeddingProvider {
    fingerprint;
    #options;
    constructor(options) {
        text(options.model, 256);
        const url = new URL(options.endpoint);
        check(["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash, "INVALID_INPUT", "Use an explicit HTTP(S) endpoint without embedded credentials.");
        integer(options.maxResponseBytes ?? 16777216, 1024, 67108864);
        this.#options = { ...options };
        this.fingerprint = "embeddings-v1:" + hash(JSON.stringify([url.href, options.model]));
    }
    async embed(input) {
        const response = await (this.#options.fetch ?? fetch)(this.#options.endpoint, {
            method: "POST", redirect: "error", signal: input.signal,
            headers: { "Content-Type": "application/json", ...(this.#options.apiKey ? { Authorization: "Bearer " + this.#options.apiKey } : {}) },
            body: JSON.stringify({ model: this.#options.model, input: input.texts, encoding_format: "float" }),
        });
        check(response.ok && response.body, "NOT_READY", "Embedding endpoint failed or returned no body.");
        const reader = response.body.getReader();
        const parts = [];
        let bytes = 0;
        try {
            while (true) {
                const part = await reader.read();
                if (part.done)
                    break;
                bytes += part.value.byteLength;
                check(bytes <= (this.#options.maxResponseBytes ?? 16777216), "INVALID_INPUT", "Embedding response exceeds byte limit.");
                parts.push(part.value);
            }
        }
        finally {
            await reader.cancel();
        }
        const result = JSON.parse(decodeUtf8(parts));
        check(Array.isArray(result.data) && result.data.length === input.texts.length, "INVALID_INPUT", "Embedding response count mismatch.");
        const vectors = new Array(input.texts.length);
        const seen = new Set();
        for (const row of result.data) {
            integer(row.index, 0, input.texts.length - 1);
            check(!seen.has(row.index), "INVALID_INPUT", "Duplicate embedding index.");
            seen.add(row.index);
            vectors[row.index] = row.embedding;
        }
        integer(result.usage?.prompt_tokens);
        return { vectors, usage: { inputTokens: result.usage.prompt_tokens, outputTokens: 0 } };
    }
}
