/**
 * Line prompts. Hidden input for secrets on a terminal; plain lines when stdin is piped
 * (scripts/tests). Prompts write to stderr so command output on stdout stays clean.
 */
import { createInterface } from "node:readline";

export interface Prompter {
  ask(question: string): Promise<string>;
  askHidden(question: string): Promise<string>;
  close(): void;
}

export class CancelledError extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "CancelledError";
  }
}

export function createPrompter(): Prompter {
  const queue: string[] = [];
  const waiters: { resolve: (l: string) => void; reject: (e: Error) => void }[] = [];
  let ended = false;
  let rl: ReturnType<typeof createInterface> | undefined;

  const pipedLine = (): Promise<string> => {
    if (!rl) {
      rl = createInterface({ input: process.stdin, terminal: false });
      rl.on("line", (line) => {
        const w = waiters.shift();
        if (w) w.resolve(line);
        else queue.push(line);
      });
      rl.on("close", () => {
        ended = true;
        while (waiters.length) waiters.shift()!.reject(new CancelledError());
      });
    }
    const next = queue.shift();
    if (next !== undefined) return Promise.resolve(next);
    if (ended) return Promise.reject(new CancelledError());
    return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
  };

  const ask = async (question: string): Promise<string> => {
    process.stderr.write(question);
    if (!process.stdin.isTTY) {
      const line = await pipedLine();
      process.stderr.write("\n");
      return line;
    }
    return new Promise((resolve, reject) => {
      const i = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
      let answered = false;
      i.on("SIGINT", () => {
        i.close();
        process.stderr.write("\n");
        reject(new CancelledError());
      });
      i.on("close", () => {
        if (!answered) reject(new CancelledError());
      });
      i.question("", (a) => {
        answered = true;
        i.close();
        resolve(a);
      });
    });
  };

  const askHidden = async (question: string): Promise<string> => {
    process.stderr.write(question);
    if (!process.stdin.isTTY) {
      const line = await pipedLine();
      process.stderr.write("\n");
      return line;
    }
    return new Promise((resolve, reject) => {
      const stdin = process.stdin;
      let value = "";
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding("utf8");
      const done = (fn: () => void) => {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off("data", onData);
        process.stderr.write("\n");
        fn();
      };
      const onData = (chunk: string) => {
        for (const ch of chunk) {
          if (ch === "\r" || ch === "\n") return done(() => resolve(value));
          if (ch === "\u0003" || ch === "\u0004") return done(() => reject(new CancelledError()));
          if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
          else if (ch >= " ") value += ch;
        }
      };
      stdin.on("data", onData);
    });
  };

  return { ask, askHidden, close: () => rl?.close() };
}
