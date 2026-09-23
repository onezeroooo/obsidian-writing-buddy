import type { EmbeddingProvider } from "./advanced-contracts.ts";
/** Explicit OpenAI-compatible embeddings endpoint. No environment discovery. */
export declare class HttpEmbeddingProvider implements EmbeddingProvider {
    #private;
    readonly fingerprint: string;
    constructor(options: {
        endpoint: string;
        model: string;
        apiKey?: string;
        fetch?: typeof fetch;
        maxResponseBytes?: number;
    });
    embed(input: Parameters<EmbeddingProvider["embed"]>[0]): ReturnType<EmbeddingProvider["embed"]>;
}
