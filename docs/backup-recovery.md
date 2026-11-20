# Backup and recovery

This guide covers the **internal wallet** used by the CLI. Browser wallets (Bitget Wallet, MetaMask…) are backed up in the wallet app itself. Grand Transfer Agent never holds their keys.

## What to back up

| What                                          | Where                      | Needed for                                                                                            |
| --------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Recovery phrase** (12 words)                | Shown once by `gta init`   | Everything. With these words anyone can rebuild the wallet and spend from it, on any device.          |
| `keystore.json`                               | `<DATA_DIR>/keystore.json` | Restoring the same wallet, together with your **password**. Without the password the file is useless. |
| `gta.db` (plus `gta.db-wal` and `gta.db-shm`) | `<DATA_DIR>/`              | Your contacts, categories, notes and ledger history. It holds no keys.                                |
| `usage.jsonl`                                 | `<DATA_DIR>/`              | Only your AI spending log. Optional.                                                                  |

`DATA_DIR` defaults to `~/.grand-transfer-agent`.

### Recovery phrase

- Write it on paper, in order, and check every word.
- Keep it offline: no photos, no cloud notes, no chat messages, no email.
- Store a second copy in a different safe place.
- Nobody needs it to help you: not support, not this app, not an AI.
- Lose it **and** the keystore password, and the funds are gone for good.

### Data folder

Stop the CLI and the web app first, so the database files are consistent. Then copy the whole folder:

```bash
cp -Rp ~/.grand-transfer-agent ~/gta-backup-$(date +%Y-%m-%d)
```

Keep that copy somewhere only you can read. The keystore inside is encrypted, but treat it as sensitive anyway.

## Restoring

### On a new machine, with the recovery phrase

```bash
pnpm install && cp .env.example .env    # set OPENROUTER_API_KEY etc.
pnpm gta init                           # choose "import a recovery phrase"
```

Type the 12 words, then choose a new password. You get the same address back. Your ETH is on the chain, not in the app, so the balance is there right away. Run `pnpm gta sync` to start logging again.

### With a keystore backup

```bash
mkdir -p ~/.grand-transfer-agent && chmod 700 ~/.grand-transfer-agent
cp ~/gta-backup-YYYY-MM-DD/keystore.json ~/.grand-transfer-agent/
chmod 600 ~/.grand-transfer-agent/keystore.json
pnpm gta address                        # should print your address
```

The next send asks for the keystore's original password.

### Bringing back your books

Copy `gta.db*` from the backup into the data folder while the app is stopped. If you don't have it, contacts and notes are lost, but transfers can be logged again from the chain with `gta sync --from-block <block>`.

## If something goes wrong

| Situation                                             | What to do                                                                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Forgot the password, still have the phrase            | Move `keystore.json` aside, run `gta init`, choose "import a recovery phrase" and set a new password.                      |
| Phrase may have leaked                                | Create a new wallet right away (`gta init` in a new `DATA_DIR`), then send everything from the old address to the new one. |
| Lost the phrase, still have the keystore and password | The wallet still works, but you have no offline backup. Move the funds to a new wallet and write down its phrase.          |
| Lost both                                             | The funds can't be recovered. Nobody can reset this.                                                                       |
