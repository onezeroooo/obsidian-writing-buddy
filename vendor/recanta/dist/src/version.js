import { SCHEMA_VERSION } from "./store/schema.js";
/** Package version; a test keeps it equal to package.json. Not a release decision. */
export const ENGINE_NAME = "recanta";
export const ENGINE_VERSION = "0.1.0";
/** Portable artifact format. Bumped only when older engines could misread a file. */
export const ARTIFACT_FORMAT = 1;
export const CAPABILITIES = [
    "document-retain-v1", "document-lifecycle-v1", "evidence-invalidation-v1", "position-boundary-v1",
    "portable-artifacts-v1", "local-rebuild-v1", "owned-processing-v1", "recall-v1",
    "source-list-v1", "source-inspect-v1", "source-revision-v1", "scoped-health-v1",
];
export const engineDescription = (indexVersion, acceleration) => ({
    engine: { name: ENGINE_NAME, version: ENGINE_VERSION }, schemaVersion: SCHEMA_VERSION, artifactFormat: ARTIFACT_FORMAT, indexVersion, acceleration, capabilities: CAPABILITIES,
});
