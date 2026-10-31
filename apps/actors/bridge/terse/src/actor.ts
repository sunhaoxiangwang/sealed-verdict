// Sealed Verdict durable case state on Terse.
//
// One CaseActor instance per case; the actor id is the caseId. The actor is a
// durable record only: it stores what the Rust clerk_daemon decided (registry,
// phase window, ledger entries with the daemon's admission status, chain head,
// final certificate). It performs no hashing, signing, admission, or tallying.
// Sequence checks make every append idempotent-safe: a repeated or out-of-order
// append is rejected instead of silently duplicated.

import { Actor, Persisted, type ActorContext } from "terse-sdk/actor"

/** Mirrors the frozen Rust LedgerEntry wire shape. `msg` is the envelope as received. */
export interface LedgerEntry {
    seq: number
    ts: number
    kind: string
    msg: Record<string, unknown>
    status: string
    reason?: string
}

/** The open phase window as the clerk_daemon reports it. */
export interface PhaseInfo {
    phase: string
    round: number
    deadlineMs: number
    closed: boolean
}

export interface CaseSummary {
    caseId: string
    entryCount: number
    head: string | null
    phase: PhaseInfo | null
    hasCert: boolean
}

interface EntryRow {
    seq: number
    ts: number
    kind: string
    msg: string
    status: string
    reason: string | null
}

export class CaseActor extends Actor {
    @Persisted registry: Record<string, unknown> | null = null
    @Persisted phase: PhaseInfo | null = null
    @Persisted head: string | null = null
    @Persisted entryCount = 0
    @Persisted cert: Record<string, unknown> | null = null

    constructor(context: ActorContext) {
        super(context)
        this.db.exec(
            "CREATE TABLE IF NOT EXISTS entries (seq INTEGER PRIMARY KEY, ts INTEGER NOT NULL, kind TEXT NOT NULL, msg TEXT NOT NULL, status TEXT NOT NULL, reason TEXT)",
        )
    }

    /** Fix the registry and the opening attest window. Rejects a case that already has state. */
    async openCase(registry: Record<string, unknown>, phase: PhaseInfo, head: string): Promise<CaseSummary> {
        if (this.registry !== null || this.entryCount > 0) {
            throw new Error("case_exists")
        }
        await this.db.transaction(async () => {
            this.registry = registry
            this.phase = phase
            this.head = head
        })
        return this.#summary()
    }

    /** Append the next ledger entry and advance the chain head. */
    async appendEntry(entry: LedgerEntry, head: string): Promise<CaseSummary> {
        await this.db.transaction(async () => {
            this.#insertEntry(entry, head)
        })
        return this.#summary()
    }

    /** Append a phase-close entry and switch to the next window in one transaction. */
    async closePhase(entry: LedgerEntry, head: string, next: PhaseInfo): Promise<CaseSummary> {
        if (entry.kind !== "phase") {
            throw new Error("not_phase")
        }
        await this.db.transaction(async () => {
            this.#insertEntry(entry, head)
            this.phase = next
        })
        return this.#summary()
    }

    async getPhase(): Promise<PhaseInfo | null> {
        return this.phase
    }

    async getRegistry(): Promise<Record<string, unknown> | null> {
        return this.registry
    }

    async getHead(): Promise<string | null> {
        return this.head
    }

    async getSummary(): Promise<CaseSummary> {
        return this.#summary()
    }

    /** Entries from `fromSeq` upward, in ledger order, with `msg` parsed back to JSON. */
    async getTranscript(fromSeq = 0): Promise<LedgerEntry[]> {
        const rows = this.db.exec(
            "SELECT seq, ts, kind, msg, status, reason FROM entries WHERE seq >= ? ORDER BY seq ASC",
            fromSeq,
        ) as unknown as EntryRow[]
        return rows.map(row => {
            const entry: LedgerEntry = {
                seq: Number(row.seq),
                ts: Number(row.ts),
                kind: row.kind,
                msg: JSON.parse(row.msg) as Record<string, unknown>,
                status: row.status,
            }
            if (row.reason !== null && row.reason !== undefined) {
                entry.reason = row.reason
            }
            return entry
        })
    }

    /** Store the final `{ cert, transcript }` bundle exactly once. */
    async setCertificate(bundle: Record<string, unknown>): Promise<CaseSummary> {
        if (this.cert !== null) {
            throw new Error("cert_exists")
        }
        this.cert = bundle
        return this.#summary()
    }

    async getCertificate(): Promise<Record<string, unknown> | null> {
        return this.cert
    }

    #insertEntry(entry: LedgerEntry, head: string): void {
        if (entry.seq !== this.entryCount) {
            throw new Error("seq_mismatch")
        }
        this.db.exec(
            "INSERT INTO entries (seq, ts, kind, msg, status, reason) VALUES (?, ?, ?, ?, ?, ?)",
            entry.seq,
            entry.ts,
            entry.kind,
            JSON.stringify(entry.msg),
            entry.status,
            entry.reason ?? null,
        )
        this.head = head
        this.entryCount = entry.seq + 1
    }

    #summary(): CaseSummary {
        return {
            caseId: this.id,
            entryCount: this.entryCount,
            head: this.head,
            phase: this.phase,
            hasCert: this.cert !== null,
        }
    }
}
