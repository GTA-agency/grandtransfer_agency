"use client";
import { useState } from "react";
import { copyText } from "@/lib/format";
import { IconCheck, IconCopy } from "./Icons";
import { useToast } from "./Toast";

export function CopyButton({ text, label = "Copy address" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const toast = useToast();
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={label}
      title={label}
      onClick={async () => {
        const ok = await copyText(text);
        toast(ok ? "Copied to clipboard" : "Couldn't copy. Select it by hand.");
        if (ok) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
    >
      {done ? <IconCheck size={15} /> : <IconCopy size={15} />}
    </button>
  );
}
