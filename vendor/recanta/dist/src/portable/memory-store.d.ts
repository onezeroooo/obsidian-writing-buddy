import type { ArtifactStore } from "./contracts.ts";
/** In-memory ArtifactStore for tests and for hosts that stage artifacts before their own transport. */
export declare class MemoryArtifactStore implements ArtifactStore {
    readonly files: Map<string, string>;
    list(prefix: string): Promise<string[]>;
    read(name: string): Promise<string | null>;
    write(name: string, text: string): Promise<void>;
    remove(name: string): Promise<void>;
}
