/** Part of the evidence/source-head transaction, including low-level ingests. */
export function supersedeProcessing(db, evidenceId) {
    const rows = db.prepare("SELECT body FROM processing_runs WHERE evidence_id=? AND status<>'superseded'").all(evidenceId);
    for (const row of rows) {
        const run = JSON.parse(String(row.body));
        run.status = "superseded";
        run.leaseToken = null;
        run.leaseUntil = null;
        run.updatedAt = new Date().toISOString();
        db.prepare("UPDATE processing_runs SET status=?,body=? WHERE id=?").run(run.status, JSON.stringify(run), run.id);
    }
}
