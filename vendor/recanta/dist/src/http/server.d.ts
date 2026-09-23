import type { MemoryHttpServer, MemoryHttpServerOptions } from "./contracts.ts";
/** Explicit server adapter. It never starts on import and owns no memory semantics. */
export declare function startMemoryHttpServer(options: MemoryHttpServerOptions): Promise<MemoryHttpServer>;
