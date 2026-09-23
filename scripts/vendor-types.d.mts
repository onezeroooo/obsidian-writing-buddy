export const TYPES_DIR: string;
export const VENDORED_TYPES: Array<{ module: string; file: string }>;
export function vendoredTypeFiles(root?: string): string[];
export function typesHash(root?: string): string;
export function typesMatchInstalled(): string[] | null;
