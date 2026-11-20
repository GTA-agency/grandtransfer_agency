#!/usr/bin/env -S npx tsx
import {
  AmountError,
  BooksError,
  ConfigError,
  ContactError,
  LlmError,
  TransferError,
  VaultError,
  isNetworkError,
} from "@gta/core";
import * as cmd from "./commands.ts";
import { createContext } from "./context.ts";
import { CancelledError, createPrompter } from "./prompt.ts";
import { fail, stdout } from "./ui.ts";

const KNOWN = [
  AmountError,
  BooksError,
  ConfigError,
  ContactError,
  LlmError,
  TransferError,
  VaultError,
  cmd.UsageError,
];

// Output piped into something that closed early (e.g. `gta history | head`): exit quietly.
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  const out = stdout;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    cmd.help(out);
    return 0;
  }
  const prompt = createPrompter();
  try {
    const env: cmd.CommandEnv = { ctx: createContext(), prompt, out };
    switch (command) {
      case "init":
        await cmd.init(env);
        break;
      case "address":
        await cmd.address(env);
        break;
      case "balance":
        await cmd.balance(env);
        break;
      case "contacts":
        await cmd.contacts(env, args);
        break;
      case "send":
        return (await cmd.send(env, args)) ? 0 : 1;
      case "chat":
        await cmd.chat(env);
        break;
      case "sync":
        await cmd.sync(env, args);
        break;
      case "books":
        await cmd.books(env, args);
        break;
      case "history":
        await cmd.history(env, args);
        break;
      case "export":
        await cmd.exportCsv(env, args);
        break;
      case "categories":
        await cmd.categories(env, args);
        break;
      case "tag":
        await cmd.tag(env, args);
        break;
      case "note":
        await cmd.note(env, args);
        break;
      case "usage":
        await cmd.usage(env);
        break;
      default:
        out.line(fail(`Unknown command "${command}".`));
        cmd.help(out);
        return 1;
    }
    return typeof process.exitCode === "number" ? process.exitCode : 0;
  } catch (err) {
    if (err instanceof CancelledError) {
      out.line("\nCancelled. Nothing was changed.");
      return 130;
    }
    if (KNOWN.some((K) => err instanceof K)) {
      out.line(fail((err as Error).message));
      return 1;
    }
    if (isNetworkError(err)) {
      out.line(
        fail(
          "Couldn't reach Robinhood Chain (or the AI service) right now. Nothing was sent. Try again in a moment.",
        ),
      );
      return 1;
    }
    const msg = err instanceof Error ? (err.message.split("\n")[0] ?? err.message) : String(err);
    out.line(fail(`Unexpected error: ${msg}`));
    return 1;
  } finally {
    prompt.close();
  }
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
