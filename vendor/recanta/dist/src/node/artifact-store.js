import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { check } from "../errors.js";
import { randomHex } from "../runtime.js";
/**
 * Directory-backed ArtifactStore for Node hosts. Writes go to a temporary sibling and are
 * renamed into place, so a reader (or a sync client) never observes a half-written file.
 * Names are validated to stay inside the root; the root path itself never enters an artifact.
 */
export class FileArtifactStore {
    #root;
    constructor(root) { check(typeof root === "string" && root.length > 0, "INVALID_INPUT", "An artifact directory is required."); this.#root = resolve(root); }
    #path(name) {
        check(typeof name === "string" && name.length > 0 && !name.includes("\0") && !name.split("/").some(part => part === "" || part === "." || part === ".."), "INVALID_INPUT", "Invalid artifact name.");
        const path = resolve(this.#root, ...name.split("/"));
        check(path.startsWith(this.#root + sep), "INVALID_INPUT", "Artifact name escapes the store root.");
        return path;
    }
    async list(prefix) {
        const names = [];
        const walk = async (directory) => {
            let entries;
            try {
                entries = await readdir(directory, { withFileTypes: true });
            }
            catch (error) {
                if (error.code === "ENOENT")
                    return;
                throw error;
            }
            for (const entry of entries) {
                const path = join(directory, entry.name);
                if (entry.isDirectory())
                    await walk(path);
                else if (entry.isFile() && entry.name.endsWith(".json")) {
                    const name = relative(this.#root, path).split(sep).join("/");
                    if (name.startsWith(prefix))
                        names.push(name);
                }
            }
        };
        await walk(this.#root);
        return names.sort();
    }
    async read(name) {
        try {
            return await readFile(this.#path(name), "utf8");
        }
        catch (error) {
            if (error.code === "ENOENT")
                return null;
            throw error;
        }
    }
    async write(name, text) {
        const path = this.#path(name);
        await mkdir(dirname(path), { recursive: true });
        const temporary = `${path}.${randomHex(6)}.tmp`;
        try {
            await writeFile(temporary, text, "utf8");
            await rename(temporary, path);
        }
        catch (error) {
            await rm(temporary, { force: true });
            throw error;
        }
    }
    async remove(name) { await rm(this.#path(name), { force: true }); }
}
