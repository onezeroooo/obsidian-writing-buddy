export declare function utf8Bytes(text: string): Uint8Array;
/** Exact UTF-8 byte length without allocating when the text is ASCII. */
export declare function utf8Length(text: string): number;
export declare function decodeUtf8(parts: readonly Uint8Array[]): string;
/** RFC 4122 v4 identifier from the platform CSPRNG; no Node module required. */
export declare function randomId(): string;
export declare function randomHex(bytes: number): string;
