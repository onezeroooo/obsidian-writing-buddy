/**
 * The build identity a bundle carries: which channel it was built for and, for
 * a development build, the short Git commit it was built from.
 *
 * Resolved here, at build time, and injected into the bundle as one string
 * constant; the running plugin never asks Git anything. The product version
 * stays in manifest.json — this is only the answer to "which build is this?".
 *
 *   dev      wb-build:dev:4cf7a03      (sha omitted when Git is unavailable)
 *   release  wb-build:release          (never carries a commit)
 *
 * Release is chosen explicitly through WB_BUILD_CHANNEL=release; everything
 * else is a development build, so an ordinary `npm run build` can never
 * produce a release-labelled bundle by accident.
 */

import { spawnSync } from "node:child_process";

export const BUILD_ID_PREFIX = "wb-build:";
export const RELEASE_BUILD_ID = BUILD_ID_PREFIX + "release";

/** The identity string for a channel and commit. A release never carries a commit. */
export function buildIdentity({ channel, sha }) {
	if (channel === "release") return RELEASE_BUILD_ID;
	const short = typeof sha === "string" ? sha.trim() : "";
	return BUILD_ID_PREFIX + "dev" + (short ? ":" + short : "");
}

/** The channel a build environment asks for: only an explicit "release" is one. */
export function channelFromEnv(env = process.env) {
	return env.WB_BUILD_CHANNEL === "release" ? "release" : "dev";
}

/** The short commit of the working tree, or "" when there is no Git to ask. */
export function shortHeadSha(cwd = process.cwd()) {
	const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8" });
	if (result.status !== 0) return "";
	const sha = result.stdout.trim();
	return /^[0-9a-f]{7,40}$/.test(sha) ? sha : "";
}

/** The identity for this build environment and working tree. */
export function resolveBuildIdentity(env = process.env, cwd = process.cwd()) {
	const channel = channelFromEnv(env);
	return buildIdentity({ channel, sha: channel === "release" ? "" : shortHeadSha(cwd) });
}
