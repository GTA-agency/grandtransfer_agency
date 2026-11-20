"use client";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { shortAddr } from "@/lib/format";
import type { ContactDto } from "@/shared/types";
import { CopyButton } from "./CopyButton";
import { IconPencil, IconTrash } from "./Icons";
import { Scene } from "./Scene";
import { useToast } from "./Toast";

const AVATAR = [
  "var(--mint)",
  "var(--peach)",
  "var(--pink)",
  "var(--lime)",
  "var(--gold)",
  "#c9a7ff",
];
const avatarColor = (name: string) =>
  AVATAR[[...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR.length];

interface Props {
  contacts: ContactDto[] | null;
  onChanged: () => void;
  onSend: (c: ContactDto) => void;
}

export function Crew({ contacts, onChanged, onSend }: Props) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const add = async () => {
    setError(null);
    try {
      await api("/api/contacts", { body: { name: name.trim(), address: address.trim() } });
      toast(`${name.trim()} joined your crew`);
      setName("");
      setAddress("");
      setAdding(false);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const rename = async (old: string) => {
    try {
      await api(`/api/contacts/${encodeURIComponent(old)}`, {
        method: "PATCH",
        body: { newName: newName.trim() },
      });
      setEditing(null);
      onChanged();
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  const remove = async (c: ContactDto) => {
    if (!window.confirm(`Remove ${c.name} from your crew? Past transactions stay in the books.`))
      return;
    try {
      await api(`/api/contacts/${encodeURIComponent(c.name)}`, { method: "DELETE" });
      toast(`${c.name} removed`);
      onChanged();
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  return (
    <article id="crew" className="art-card lift reveal" aria-labelledby="crew-title">
      <div className="art-top">
        <Scene variant="sunset" seed={3} palms="both" sunX={0.5} sunSize={0.8} horizon={540} />
        <div className="crew-list">
          {contacts === null && <div className="crew-empty">Loading your crew…</div>}
          {contacts?.length === 0 && !adding && (
            <div className="crew-empty">
              No one in your crew yet.
              <br />
              Add your Robinhood address as <strong>robinhood</strong>.
            </div>
          )}
          {contacts?.map((c) => (
            <div key={c.name} className="crew-item">
              <div
                className="crew-avatar"
                style={{ background: avatarColor(c.name) }}
                aria-hidden="true"
              >
                {c.name[0]}
              </div>
              <div className="crew-text">
                {editing === c.name ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void rename(c.name);
                    }}
                    style={{ display: "flex", gap: 6 }}
                  >
                    <label htmlFor={`rn-${c.name}`} className="sr-only">
                      New name for {c.name}
                    </label>
                    <input
                      id={`rn-${c.name}`}
                      className="input"
                      style={{ minHeight: 32, padding: "0 10px" }}
                      value={newName}
                      autoFocus
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                    />
                    <button className="btn small mint" type="submit">
                      Save
                    </button>
                  </form>
                ) : (
                  <>
                    <div className="crew-name">{c.name}</div>
                    <div className="crew-addr" title={c.address}>
                      {shortAddr(c.address)}
                    </div>
                  </>
                )}
              </div>
              {editing !== c.name && (
                <div className="crew-actions">
                  <CopyButton text={c.address} label={`Copy ${c.name}'s address`} />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Rename ${c.name}`}
                    title="Rename"
                    onClick={() => {
                      setEditing(c.name);
                      setNewName(c.name);
                    }}
                  >
                    <IconPencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove ${c.name}`}
                    title="Remove"
                    onClick={() => void remove(c)}
                  >
                    <IconTrash size={14} />
                  </button>
                  <button type="button" className="btn small hot" onClick={() => onSend(c)}>
                    Send
                  </button>
                </div>
              )}
            </div>
          ))}
          {adding ? (
            <form
              className="crew-form"
              onSubmit={(e) => {
                e.preventDefault();
                void add();
              }}
            >
              <label htmlFor="crew-name" className="sr-only">
                Name
              </label>
              <input
                id="crew-name"
                className="input"
                placeholder="name"
                value={name}
                maxLength={40}
                autoFocus
                onChange={(e) => setName(e.target.value)}
              />
              <label htmlFor="crew-address" className="sr-only">
                Address
              </label>
              <input
                id="crew-address"
                className="input mono"
                placeholder="0x…"
                value={address}
                maxLength={42}
                spellCheck={false}
                onChange={(e) => setAddress(e.target.value)}
              />
              <button className="btn mint" type="submit" disabled={!name.trim() || !address.trim()}>
                Add
              </button>
              {error && (
                <p className="form-error" role="alert" style={{ gridColumn: "1 / -1" }}>
                  {error}
                </p>
              )}
            </form>
          ) : (
            <div style={{ padding: 8 }}>
              <button type="button" className="btn ghost block" onClick={() => setAdding(true)}>
                + Add to crew
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="art-bottom">
        <p className="eyebrow">Contacts</p>
        <h2 id="crew-title" className="display md">
          Your crew on speed dial
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          Save addresses by name. Then just say &ldquo;send 0.01 to robinhood&rdquo; or &ldquo;show
          my robinhood address&rdquo;. No copy-pasting long hex strings.
        </p>
      </div>
    </article>
  );
}
