import type { Database, SqlValue, Statement } from "@gta/core";

/** The parts of a Durable Object's storage this adapter needs (from @cloudflare/workers-types). */
interface DoStorage {
  sql: {
    exec(
      query: string,
      ...bindings: unknown[]
    ): {
      toArray(): Record<string, unknown>[];
      readonly rowsWritten: number;
    };
  };
  transactionSync<T>(fn: () => T): T;
}

const META = "gta_meta";

/**
 * A Durable Object's SQLite storage behind the same synchronous API the app uses with
 * node:sqlite locally. Two things work differently there and are mapped here:
 * - transactions: BEGIN/COMMIT aren't allowed; `transaction()` uses storage.transactionSync;
 * - PRAGMA user_version isn't available; the migration counter lives in a small meta table.
 */
export class DoSqlDatabase implements Database {
  constructor(private readonly storage: DoStorage) {
    this.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS ${META} (key TEXT PRIMARY KEY, value INTEGER NOT NULL)`,
    );
  }

  private run(query: string, params: SqlValue[]) {
    const bindings = params.map((p) => {
      if (typeof p === "bigint") {
        if (p > BigInt(Number.MAX_SAFE_INTEGER) || p < -BigInt(Number.MAX_SAFE_INTEGER)) {
          return p.toString();
        }
        return Number(p);
      }
      return p;
    });
    return this.storage.sql.exec(query, ...bindings);
  }

  prepare(query: string): Statement {
    const trimmed = query.trim();
    if (/^PRAGMA\s+user_version$/i.test(trimmed)) {
      return {
        get: () => ({ user_version: this.userVersion() }),
        all: () => [{ user_version: this.userVersion() }],
        run: () => ({ changes: 0, lastInsertRowid: 0 }),
      };
    }
    return {
      get: (...params) => this.run(query, params).toArray()[0],
      all: (...params) => this.run(query, params).toArray(),
      run: (...params) => {
        const cursor = this.run(query, params);
        cursor.toArray(); // execute fully before reading counters
        const id = this.storage.sql.exec("SELECT last_insert_rowid() AS id").toArray()[0]?.id;
        return { changes: cursor.rowsWritten, lastInsertRowid: Number(id ?? 0) };
      },
    };
  }

  exec(query: string): void {
    const trimmed = query.trim();
    const set = /^PRAGMA\s+user_version\s*=\s*(\d+)\s*;?$/i.exec(trimmed);
    if (set) {
      this.storage.sql.exec(
        `INSERT INTO ${META} (key, value) VALUES ('user_version', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        Number(set[1]),
      );
      return;
    }
    if (/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(trimmed)) return; // see transaction()
    if (/^PRAGMA\s+(journal_mode|foreign_keys)/i.test(trimmed)) return; // managed by Cloudflare
    this.storage.sql.exec(query).toArray();
  }

  transaction<T>(fn: () => T): T {
    return this.storage.transactionSync(fn);
  }

  private userVersion(): number {
    const row = this.storage.sql
      .exec(`SELECT value FROM ${META} WHERE key = 'user_version'`)
      .toArray()[0];
    return Number(row?.value ?? 0);
  }
}
