"use client";
import { useCallback, useEffect, useState } from "react";
import { api, onLocked } from "@/lib/api";
import type { SessionDto } from "@/shared/types";
import { Dashboard } from "./Dashboard";
import { Landing } from "./Landing";
import { Providers } from "./Providers";
import { ToastProvider } from "./Toast";

export function App() {
  const [info, setInfo] = useState<SessionDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<SessionDto>("/api/session").then(
      (s) => {
        setInfo(s);
        setError(null);
      },
      (e: Error) => setError(e.message),
    );
  }, []);

  useEffect(() => {
    load();
    return onLocked(load);
  }, [load]);

  return (
    <Providers>
      <ToastProvider>
        {error && !info && (
          <main className="shell" style={{ paddingTop: 80 }}>
            <p className="form-error">{error}</p>
          </main>
        )}
        {info &&
          (info.session ? (
            <Dashboard key={info.session.address} session={info.session} onLocked={load} />
          ) : (
            <Landing info={info} onSignedIn={load} />
          ))}
      </ToastProvider>
    </Providers>
  );
}
