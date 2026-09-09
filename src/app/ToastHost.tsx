"use client";

import { useEffect, useState } from "react";
import { onToast, Toast, ToastKind } from "./toast";

// Single global toast surface — mounted once by AppShell. Auto-dismisses.

const STYLES: Record<ToastKind, string> = {
  success:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 shadow-[0_8px_30px_rgba(16,185,129,0.15)]",
  error:
    "border-rose-500/30 bg-rose-500/10 text-rose-200 shadow-[0_8px_30px_rgba(244,63,94,0.15)]",
  info: "border-slate-600/40 bg-slate-800/90 text-slate-100 shadow-[0_8px_30px_rgba(0,0,0,0.35)]",
};

const DOT: Record<ToastKind, string> = {
  success: "bg-emerald-400",
  error: "bg-rose-400",
  info: "bg-sky-400",
};

export default function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    return onToast((t) => {
      setToasts((prev) => [...prev.slice(-4), t]); // keep max 5
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, 3500);
    });
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[200] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-center gap-2.5 rounded-2xl border px-4 py-3 text-[13px] font-medium backdrop-blur-xl animate-pop-in ${STYLES[t.kind]}`}
          role="status"
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[t.kind]}`} />
          {t.text}
        </div>
      ))}
    </div>
  );
}
