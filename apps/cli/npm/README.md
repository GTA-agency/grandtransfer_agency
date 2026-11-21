# Grand Transfer Agent CLI

**You call the shots. The agent makes the run.**

`gta` is an AI wallet agent for **Robinhood Chain** in your terminal. Type what you want in plain words, for example "send 0.01 ETH to robinhood". The agent finds the address, checks your limits and shows you the plan. Nothing moves until you type `yes`.

Web app: [grandtransfer.agency](https://grandtransfer.agency) · Source: [GitHub](https://github.com/GTA-agency/grandtransfer_agency) · X: [@grandtransferHQ](https://x.com/grandtransferHQ)

> Transfers on Robinhood Chain (mainnet, chain ID 4663) are real and final. Start with small amounts.

## Install

Requires **Node.js 22.13 or newer**. One line installs it and starts it:

```bash
npm i -g grand-transfer-agent && gta
```

The first run creates (or imports) your wallet and opens the agent right away. No API key and no other setup: chat runs on the same agent as [grandtransfer.agency](https://grandtransfer.agency), with a daily message limit per wallet. Signing in is a free message from your wallet, never a transaction, and your keys and password never leave your machine.

Next time, just type `gta`.

## Commands

```bash
gta                            # start: the agent (sets up your wallet the first time)
gta init                       # create or import a wallet (gta does this for you the first time)
gta address                    # your address
gta balance                    # ETH balance (≈ USD) and your limits
gta contacts add robinhood 0x… # save an address by name
gta send 0.01 robinhood        # shows THE PLAN; type "yes", then your password
gta chat                       # talk to the agent; every plan still needs your "yes"
gta sync                       # pick up incoming ETH and sends made elsewhere
gta books month                # recap: today | week | month | year | all
gta history 20                 # latest transactions
gta tag <hash> Food            # categorize
gta note <hash> "rent split"   # add a note
gta export books.csv month     # CSV
gta help                       # every command
gta --version
```

## Ask the agent

```text
send 0.01 eth to robinhood        # plan an ETH send
send 1000 GTA to alex             # plan a $GTA send
is 0x… the real $GTA?             # check a contract on chain
request 0.01 ETH                  # make a payment link that pays your wallet
what did I spend this month?      # read your books
```

## Safety

- **Your key stays on your machine.** It lives in an encrypted keystore (scrypt + AES), file mode 600. It is decrypted only while you send and locks itself after 5 idle minutes.
- **The AI only plans.** It can read your balance, contacts and ledger and draft a transfer. It has no tool that sends or signs anything.
- **You confirm every send.** You see the recipient (name and full address), the amount, the gas and the total, then type `yes` and your password.
- **Limits in code.** At most 0.05 ETH per send and 0.2 ETH per 24 hours by default. Change them with `MAX_TX_ETH` and `MAX_DAILY_ETH` in `~/.grand-transfer-agent/.env`.
- **Only the official $GTA can be sent.** Token sends have their own limits: 10,000,000 GTA per send and 50,000,000 per 24 hours.
- **Your 12-word recovery phrase is shown once.** Write it on paper; no one can recover it for you.

## Settings

All settings can go in `~/.grand-transfer-agent/.env` or the environment:

| Variable                       | Default                                    |
| ------------------------------ | ------------------------------------------ |
| `RPC_URL`                      | public Robinhood Chain RPCs, with fallback |
| `ARCHIVE_RPC_URL`              | `https://robinhood.drpc.org`               |
| `DATA_DIR`                     | `~/.grand-transfer-agent`                  |
| `MAX_TX_ETH` / `MAX_DAILY_ETH` | `0.05` / `0.2`                             |

USD values are approximate (CoinGecko, with Coinbase and Kraken as fallbacks) and are for display only.

## License

MIT. Grand Transfer Agent is an independent project, not affiliated with Rockstar Games, Take-Two Interactive or Robinhood.
