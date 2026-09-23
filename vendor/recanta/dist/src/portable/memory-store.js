/** In-memory ArtifactStore for tests and for hosts that stage artifacts before their own transport. */
export class MemoryArtifactStore {
    files = new Map();
    async list(prefix) { return [...this.files.keys()].filter(name => name.startsWith(prefix)).sort(); }
    async read(name) { return this.files.get(name) ?? null; }
    async write(name, text) { this.files.set(name, text); }
    async remove(name) { this.files.delete(name); }
}
