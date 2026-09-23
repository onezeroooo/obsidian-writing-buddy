export const MANIFEST_FILE: string;
export function resolveRecantaManifest(): Promise<{ package: string; commit: string; version: string; engine: string; schemaVersion: number; artifactFormat: number; vendor: string; source: string }>;
export function readRecantaManifest(): { package: string; commit: string; version: string; engine: string; schemaVersion: number; artifactFormat: number; vendor: string; source: string };
