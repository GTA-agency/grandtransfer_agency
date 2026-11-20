/**
 * Minimal line prompts for dev scripts. Hidden input when attached to a terminal;
 * reads plain lines when stdin is piped (used for automated checks only).
 */
import { createInterface } from "node:readline";

const queue: string[] = [];
const waiters: ((line: string) => void)[] = [];
let rl: ReturnType<typeof createInterface> | undefined;

function pipedLine(): Promise<string> {
  if (!rl) {
    rl = createInterface({ input: process.stdin, terminal: false });
    rl.on("line", (line) => {
      const w = waiters.shift();
      if (w) w(line);
      else queue.push(line);
    });
  }
  const next = queue.shift();
  return next !== undefined ? Promise.resolve(next) : new Promise((r) => waiters.push(r));
}

export async function ask(question: string): Promise<string> {
  process.stdout.write(question);
  if (!process.stdin.isTTY) {
    const line = await pipedLine();
    process.stdout.write("\n");
    return line;
  }
  return new Promise((resolve) => {
    const i = createInterface({ input: process.stdin, output: process.stdout });
    i.question("", (a) => {
      i.close();
      resolve(a);
    });
  });
}

export async function askHidden(question: string): Promise<string> {
  process.stdout.write(question);
  if (!process.stdin.isTTY) {
    const line = await pipedLine();
    process.stdout.write("\n");
    return line;
  }
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          reject(new Error("Cancelled"));
          return;
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

export function closePrompts(): void {
  rl?.close();
}
