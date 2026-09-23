export const VENDOR_DIR: string;
export function vendoredFiles(root?: string): string[];
export function vendorHash(root?: string): string;
export function installedEngineDir(): string | null;
export function vendorMatchesInstalled(): string[] | null;
