import type { ArtifactStore } from "../portable/contracts.ts";
/**
 * Directory-backed ArtifactStore for Node hosts. Writes go to a temporary sibling and are
 * renamed into place, so a reader (or a sync client) never observes a half-written file.
 * Names are validated to stay inside the root; the root path itself never enters an artifact.
 */
export declare class FileArtifactStore implements ArtifactStore {
    constructor(root: string);
    list(prefix: string): Promise<string[]>;
    read(name: string): Promise<string | null>;
    write(name: string, text: string): Promise<void>;
    remove(name: string): Promise<void>;
}
