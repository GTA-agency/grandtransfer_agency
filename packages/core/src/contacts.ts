import { getAddress, isAddress, type Address } from "viem";
import type { Database } from "./db.ts";

export interface Contact {
  id: number;
  name: string;
  address: Address;
}

export class ContactError extends Error {
  constructor(
    public readonly code: "INVALID_NAME" | "INVALID_ADDRESS" | "DUPLICATE_NAME" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "ContactError";
  }
}

export type Resolution =
  | { kind: "contact"; contact: Contact }
  | { kind: "address"; address: Address; contact?: Contact }
  | { kind: "ambiguous"; query: string; candidates: Contact[] }
  | { kind: "not_found"; query: string };

const NAME = /^[a-z0-9][a-z0-9 _.-]{0,39}$/i;

/**
 * Validate an address string. All-lowercase/uppercase hex is accepted; mixed case must have a
 * valid EIP-55 checksum (catches typos). Returns the checksummed address.
 */
export function parseAddress(input: string): Address {
  const value = input.trim();
  if (!isAddress(value, { strict: true })) {
    throw new ContactError(
      "INVALID_ADDRESS",
      `"${input}" is not a valid address (or its checksum is wrong).`,
    );
  }
  return getAddress(value);
}

export function looksLikeAddress(input: string): boolean {
  return /^0x[0-9a-fA-F]*$/.test(input.trim());
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

interface Row {
  id: number;
  name: string;
  address: string;
}
const toContact = (r: Row): Contact => ({ id: r.id, name: r.name, address: r.address as Address });

/** Contacts of one owner: 'local' for the CLI and the local web app, a wallet address in public mode. */
export const LOCAL_OWNER = "local";

export class AddressBook {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
    readonly owner: string = LOCAL_OWNER,
  ) {}

  list(): Contact[] {
    return (
      this.db
        .prepare("SELECT id, name, address FROM contacts WHERE owner = ? ORDER BY name")
        .all(this.owner) as unknown as Row[]
    ).map(toContact);
  }

  get(name: string): Contact | undefined {
    const row = this.db
      .prepare("SELECT id, name, address FROM contacts WHERE owner = ? AND name = ?")
      .get(this.owner, name.trim()) as unknown as Row | undefined;
    return row ? toContact(row) : undefined;
  }

  findByAddress(address: Address): Contact | undefined {
    const row = this.db
      .prepare(
        "SELECT id, name, address FROM contacts WHERE owner = ? AND lower(address) = lower(?) ORDER BY name LIMIT 1",
      )
      .get(this.owner, address) as unknown as Row | undefined;
    return row ? toContact(row) : undefined;
  }

  /** Check a would-be contact without saving it. Returns the cleaned name and checksummed address. */
  validate(name: string, address: string): { name: string; address: Address } {
    const clean = this.assertName(name);
    const addr = parseAddress(address);
    if (this.get(clean))
      throw new ContactError("DUPLICATE_NAME", `A contact named "${clean}" already exists.`);
    return { name: clean, address: addr };
  }

  add(name: string, address: string): Contact {
    const { name: clean, address: addr } = this.validate(name, address);
    const t = this.now();
    const res = this.db
      .prepare(
        "INSERT INTO contacts (owner, name, address, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(this.owner, clean, addr, t, t);
    return { id: Number(res.lastInsertRowid), name: clean, address: addr };
  }

  rename(oldName: string, newName: string): Contact {
    const existing = this.require(oldName);
    const clean = this.assertName(newName);
    const clash = this.get(clean);
    if (clash && clash.id !== existing.id) {
      throw new ContactError("DUPLICATE_NAME", `A contact named "${clean}" already exists.`);
    }
    this.db
      .prepare("UPDATE contacts SET name = ?, updated_at = ? WHERE id = ? AND owner = ?")
      .run(clean, this.now(), existing.id, this.owner);
    return { ...existing, name: clean };
  }

  remove(name: string): void {
    const existing = this.require(name);
    this.db.prepare("DELETE FROM contacts WHERE id = ? AND owner = ?").run(existing.id, this.owner);
  }

  /**
   * Turn what the user typed into a recipient. Only an exact (case-insensitive) name or a valid
   * address resolves directly; anything fuzzy comes back as "ambiguous" so the caller must ask.
   */
  resolve(input: string): Resolution {
    const query = input.trim();
    if (looksLikeAddress(query)) {
      const address = parseAddress(query);
      const contact = this.findByAddress(address);
      return contact ? { kind: "address", address, contact } : { kind: "address", address };
    }
    const exact = this.get(query);
    if (exact) return { kind: "contact", contact: exact };

    const q = query.toLowerCase();
    const candidates = this.list().filter((c) => {
      const n = c.name.toLowerCase();
      return n.includes(q) || q.includes(n) || (q.length >= 3 && levenshtein(n, q) <= 2);
    });
    return candidates.length > 0
      ? { kind: "ambiguous", query, candidates }
      : { kind: "not_found", query };
  }

  private require(name: string): Contact {
    const c = this.get(name);
    if (!c) throw new ContactError("NOT_FOUND", `No contact named "${name.trim()}".`);
    return c;
  }

  private assertName(name: string): string {
    const clean = name.trim().replace(/\s+/g, " ");
    if (!NAME.test(clean)) {
      throw new ContactError(
        "INVALID_NAME",
        "Contact names are 1–40 characters: letters, digits, spaces, dot, dash or underscore.",
      );
    }
    return clean;
  }
}
