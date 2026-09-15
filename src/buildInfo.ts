/**
 * Which build this is: a development build from a private commit, or a
 * release. The bundle carries one string constant, injected by esbuild from
 * `scripts/build-identity.mjs`; nothing here reads Git or the environment.
 *
 * The product version is not part of it — that stays in manifest.json, and
 * the label takes it from there so no second copy of the version exists.
 */

/** Injected at build time. Absent under the test runner, which makes a development build with no commit. */
declare const __WB_BUILD_ID__: string | undefined;

export type BuildChannel = "dev" | "release";

export interface BuildInfo {
	channel: BuildChannel;
	/** Short commit of a development build; empty when unknown, always empty for a release. */
	sha: string;
}

const BUILD_ID_PREFIX = "wb-build:";

/** Read the injected identity string back into its parts. Anything unrecognised is a development build with no commit. */
export function parseBuildId(id: string | undefined): BuildInfo {
	if (typeof id !== "string" || !id.startsWith(BUILD_ID_PREFIX)) return { channel: "dev", sha: "" };
	const [channel, sha = ""] = id.slice(BUILD_ID_PREFIX.length).split(":");
	if (channel === "release") return { channel: "release", sha: "" };
	return { channel: "dev", sha: /^[0-9a-f]{7,40}$/.test(sha) ? sha : "" };
}

export const BUILD_INFO: BuildInfo = parseBuildId(typeof __WB_BUILD_ID__ === "string" ? __WB_BUILD_ID__ : undefined);

/**
 * The line a writer can quote: `Writing Buddy 0.1.0 · dev 4cf7a03` or
 * `Writing Buddy 0.1.0 · release`. A development build whose commit is
 * unknown reads `· dev`.
 */
export function buildLabel(version: string, info: BuildInfo = BUILD_INFO): string {
	const channel = info.channel === "release" ? "release" : info.sha ? "dev " + info.sha : "dev";
	return "Writing Buddy " + version + " · " + channel;
}
