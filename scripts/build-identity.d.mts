/** Types for build-identity.mjs, which the test suite imports. */
export type BuildChannel = "dev" | "release";
export const BUILD_ID_PREFIX: string;
export const RELEASE_BUILD_ID: string;
export function buildIdentity(input: { channel: BuildChannel; sha?: string }): string;
export function channelFromEnv(env?: Record<string, string | undefined>): BuildChannel;
export function shortHeadSha(cwd?: string): string;
export function resolveBuildIdentity(env?: Record<string, string | undefined>, cwd?: string): string;
