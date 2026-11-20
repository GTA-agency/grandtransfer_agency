"use client";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

const Ctx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    clearTimeout(timer.current);
    // Long news (e.g. incoming ETH) stays up longer: about 2s plus reading time, at most 6s.
    timer.current = setTimeout(() => setMsg(null), Math.min(6000, 2200 + m.length * 35));
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div aria-live="polite" className="sr-only">
        {msg}
      </div>
      {msg && <div className="toast">{msg}</div>}
    </Ctx.Provider>
  );
}
