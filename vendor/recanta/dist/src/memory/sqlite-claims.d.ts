import type { SqlDatabase } from "../store/driver.ts";
import type { Access } from "../contracts.ts";
import type { ClaimHistoryRequest, ClaimReceipt, ClaimRevision, ClaimWrite, FactKey, FactState } from "./contracts.ts";
export declare const CLAIM_SCHEMA = "\nCREATE TABLE claim_revisions (\n  namespace_id TEXT NOT NULL REFERENCES namespaces(id),\n  scope_id TEXT NOT NULL,\n  subject_id TEXT NOT NULL,\n  predicate TEXT NOT NULL,\n  revision INTEGER NOT NULL CHECK(revision > 0),\n  version INTEGER NOT NULL CHECK(version > 0),\n  operation_id TEXT NOT NULL,\n  payload_hash TEXT NOT NULL,\n  body TEXT NOT NULL,\n  PRIMARY KEY(namespace_id,scope_id,subject_id,predicate,revision),\n  UNIQUE(namespace_id,operation_id),\n  UNIQUE(namespace_id,version)\n) STRICT;\n";
/** Internal adapter component. The owner wraps every method in one transaction. */
export declare class SqliteClaims {
    #private;
    constructor(db: SqlDatabase);
    write(access: Access, input: ClaimWrite): ClaimReceipt;
    read(access: Access, key: FactKey, options: {
        knownAtVersion?: number;
        positionBoundary?: string;
    }): Omit<FactState, "snapshot">;
    history(access: Access, request: ClaimHistoryRequest): ClaimRevision[];
}
