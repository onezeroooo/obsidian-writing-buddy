/**
 * Runtime-neutral primitives. The core must not depend on Node globals (Buffer, process)
 * or Node built-in modules; everything here is available in browsers, WebViews and Node.
 */
const encoder = new TextEncoder();
export function utf8Bytes(text) { return encoder.encode(text); }
/** Exact UTF-8 byte length without allocating when the text is ASCII. */
export function utf8Length(text) {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 0x80)
            bytes += 1;
        else if (code < 0x800)
            bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff) {
            bytes += 4;
            i++;
        }
        else
            bytes += 3;
    }
    return bytes;
}
export function decodeUtf8(parts) {
    const decoder = new TextDecoder("utf-8");
    let text = "";
    for (const part of parts)
        text += decoder.decode(part, { stream: true });
    return text + decoder.decode();
}
/** RFC 4122 v4 identifier from the platform CSPRNG; no Node module required. */
export function randomId() {
    const platform = globalThis.crypto;
    if (platform && typeof platform.randomUUID === "function")
        return platform.randomUUID();
    const bytes = new Uint8Array(16);
    platform.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function randomHex(bytes) {
    const buffer = new Uint8Array(bytes);
    globalThis.crypto.getRandomValues(buffer);
    return Array.from(buffer, byte => byte.toString(16).padStart(2, "0")).join("");
}
