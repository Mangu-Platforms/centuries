"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface ToastItem {
  id: string;
  message: string;
  variant: "error" | "success";
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastItem["variant"]) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// Long enough to read a short sentence, short enough not to pile up if
// several background loads fail around the same time.
const AUTO_DISMISS_MS = 5000;

// Phase F3: a global, dependency-free toast layer for failures that have no
// natural place to render inline -- a background list load (dashboard
// overview, connections, sessions) or an optimistic action's rollback
// (PostCard's like/bookmark). Errors that already have a form-adjacent
// spot (login, composer, connect-a-platform) keep their existing inline
// `error` state; this isn't meant to replace those.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, variant: ToastItem["variant"] = "error") => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev, { id, message, variant }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="alert"
            className={`pointer-events-auto flex max-w-sm items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ring-1 ring-inset ${
              t.variant === "error" ? "bg-rose-600 ring-rose-700/40" : "bg-emerald-600 ring-emerald-700/40"
            }`}
          >
            <span className="flex-1">{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="shrink-0 opacity-80 transition hover:opacity-100" aria-label="Dismiss">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-3.5 w-3.5">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
