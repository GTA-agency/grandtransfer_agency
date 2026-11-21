import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

/**
 * Schema migrations, applied in order. PRAGMA user_version tracks the applied count.
 * Never edit a released migration; append a new one instead.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE contacts (
    id          INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    address     TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE ledger (
    id            INTEGER PRIMARY KEY,
    tx_hash       TEXT    NOT NULL UNIQUE,
    direction     TEXT    NOT NULL CHECK (direction IN ('in', 'out')),
    wallet        TEXT    NOT NULL,
    counterparty  TEXT    NOT NULL,
    contact_name  TEXT,
    amount_wei    TEXT    NOT NULL,
    fee_wei       TEXT,
    status        TEXT    NOT NULL CHECK (status IN ('pending', 'confirmed', 'failed')),
    block_number  INTEGER,
    timestamp     INTEGER NOT NULL,
    category      TEXT,
    note          TEXT
  );
  CREATE INDEX ledger_wallet_time ON ledger (wallet, timestamp);
  `,
  // 2 — phase 4: one tx may appear once per (wallet, direction); entry source; sync checkpoint;
  //     categories.
  `
  CREATE TABLE ledger_v2 (
    id            INTEGER PRIMARY KEY,
    tx_hash       TEXT    NOT NULL,
    direction     TEXT    NOT NULL CHECK (direction IN ('in', 'out')),
    wallet        TEXT    NOT NULL,
    counterparty  TEXT    NOT NULL,
    contact_name  TEXT,
    amount_wei    TEXT    NOT NULL,
    fee_wei       TEXT,
    status        TEXT    NOT NULL CHECK (status IN ('pending', 'confirmed', 'failed')),
    block_number  INTEGER,
    timestamp     INTEGER NOT NULL,
    category      TEXT,
    note          TEXT,
    source        TEXT    NOT NULL DEFAULT 'agent' CHECK (source IN ('agent', 'sync', 'internal')),
    UNIQUE (tx_hash, wallet, direction)
  );
  INSERT INTO ledger_v2 (id, tx_hash, direction, wallet, counterparty, contact_name, amount_wei,
                         fee_wei, status, block_number, timestamp, category, note, source)
    SELECT id, tx_hash, direction, wallet, counterparty, contact_name, amount_wei,
           fee_wei, status, block_number, timestamp, category, note, 'agent' FROM ledger;
  DROP TABLE ledger;
  ALTER TABLE ledger_v2 RENAME TO ledger;
  CREATE INDEX ledger_wallet_time ON ledger (wallet, timestamp);
  CREATE INDEX ledger_wallet_block ON ledger (wallet, block_number);

  CREATE TABLE sync_state (
    wallet       TEXT    PRIMARY KEY COLLATE NOCASE,
    last_block   INTEGER NOT NULL,
    balance_wei  TEXT    NOT NULL,
    nonce        INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );

  CREATE TABLE categories (
    name        TEXT    PRIMARY KEY COLLATE NOCASE,
    builtin     INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );
  INSERT INTO categories (name, builtin, created_at) VALUES
    ('Transfer', 1, 0), ('Income', 1, 0), ('Savings', 1, 0), ('Bills', 1, 0), ('Food', 1, 0),
    ('Shopping', 1, 0), ('Trading', 1, 0), ('Gift', 1, 0), ('Other', 1, 0);
  `,
  // 3 — phase 8: data per owner (a wallet address in the public web app, 'local' otherwise),
  //     and per-wallet AI usage for daily quotas. Existing rows become 'local'.
  `
  CREATE TABLE contacts_v3 (
    id          INTEGER PRIMARY KEY,
    owner       TEXT    NOT NULL DEFAULT 'local',
    name        TEXT    NOT NULL COLLATE NOCASE,
    address     TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    UNIQUE (owner, name)
  );
  INSERT INTO contacts_v3 (id, owner, name, address, created_at, updated_at)
    SELECT id, 'local', name, address, created_at, updated_at FROM contacts;
  DROP TABLE contacts;
  ALTER TABLE contacts_v3 RENAME TO contacts;

  CREATE TABLE categories_v3 (
    owner       TEXT    NOT NULL,
    name        TEXT    NOT NULL COLLATE NOCASE,
    builtin     INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (owner, name)
  );
  INSERT INTO categories_v3 (owner, name, builtin, created_at)
    SELECT CASE WHEN builtin = 1 THEN '*' ELSE 'local' END, name, builtin, created_at FROM categories;
  DROP TABLE categories;
  ALTER TABLE categories_v3 RENAME TO categories;

  CREATE TABLE ai_usage (
    day         TEXT    NOT NULL,
    wallet      TEXT    NOT NULL COLLATE NOCASE,
    messages    INTEGER NOT NULL DEFAULT 0,
    cost_usd    REAL    NOT NULL DEFAULT 0,
    PRIMARY KEY (day, wallet)
  );
  `,
  // 4 — phase 9: web sessions survive restarts (and Durable Object evictions).
  `
  CREATE TABLE web_sessions (
    token       TEXT    PRIMARY KEY,
    address     TEXT    NOT NULL,
    last_seen   INTEGER NOT NULL
  );
  CREATE INDEX web_sessions_seen ON web_sessions (last_seen);
  `,
  // 5 — token sends. The ledger row keeps the recipient and the gas (0 ETH moved); this adds what
  //     token moved, so ETH totals and ETH limits stay exactly as they were.
  `
  CREATE TABLE token_transfers (
    tx_hash       TEXT    NOT NULL,
    wallet        TEXT    NOT NULL,
    token         TEXT    NOT NULL,
    symbol        TEXT    NOT NULL,
    decimals      INTEGER NOT NULL,
    amount_units  TEXT    NOT NULL,
    PRIMARY KEY (tx_hash, wallet)
  );
  CREATE INDEX token_transfers_wallet ON token_transfers (wallet, token);
  `,
  // 6 — incoming tokens: how far each wallet's token logs have been read.
  `
  CREATE TABLE token_sync (
    wallet      TEXT    NOT NULL COLLATE NOCASE,
    token       TEXT    NOT NULL COLLATE NOCASE,
    last_block  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (wallet, token)
  );
  `,
  // 7 — the token checkpoint also keeps the balance and nonce at that block, so whole ranges with
  //     no change can be skipped (free RPCs only serve 100 blocks of logs per query).
  `
  DROP TABLE token_sync;
  CREATE TABLE token_sync (
    wallet         TEXT    NOT NULL COLLATE NOCASE,
    token          TEXT    NOT NULL COLLATE NOCASE,
    last_block     INTEGER NOT NULL,
    balance_units  TEXT    NOT NULL,
    nonce          INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    PRIMARY KEY (wallet, token)
  );
  `,
];

/** One prepared statement. node:sqlite's StatementSync fits; so does the Durable Object adapter. */
export interface Statement {
  get(...params: SqlValue[]): unknown;
  all(...params: SqlValue[]): unknown[];
  run(...params: SqlValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}

export type SqlValue = string | number | bigint | null | Uint8Array;

/**
 * The slice of SQLite the app uses: synchronous prepared statements and exec. Implemented by
 * node:sqlite's DatabaseSync locally and by a Durable Object's SQL storage on Cloudflare.
 */
export interface Database {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  close?(): void;
  /** Run `fn` atomically. Defaults to BEGIN/COMMIT. */
  transaction?<T>(fn: () => T): T;
}

export function inTransaction<T>(db: Database, fn: () => T): T {
  if (db.transaction) return db.transaction(fn);
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** Apply pending migrations. PRAGMA user_version counts the applied ones. */
export function migrate(db: Database): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    inTransaction(db, () => {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/** Open (and migrate) the SQLite database at <dataDir>/gta.db, or in memory for tests. */
export function openDatabase(dataDir: string | ":memory:"): Database {
  // Loaded at call time, not imported: bundles for runtimes without node:sqlite (Cloudflare
  // Workers) never call this, and a static import would fail there.
  const { DatabaseSync: Sqlite } = process.getBuiltinModule("node:sqlite") as {
    DatabaseSync: typeof DatabaseSync;
  };
  let path = ":memory:";
  if (dataDir !== ":memory:") {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    path = join(dataDir, "gta.db");
  }
  const db = new Sqlite(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  migrate(db as unknown as Database);
  return db as unknown as Database;
}
