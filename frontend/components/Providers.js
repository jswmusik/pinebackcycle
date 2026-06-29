"use client";

import {
  createContext,
  useCallback as useCb,
  useContext,
  useRef,
  useState,
} from "react";

// =====================================================================
// Toast
// =====================================================================
const ToastContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast måste användas inom <Providers>");
  return ctx;
}

// =====================================================================
// Confirm-dialog (ersätter window.confirm)
// =====================================================================
const ConfirmContext = createContext(null);

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm måste användas inom <Providers>");
  return ctx;
}

export default function Providers({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const remove = useCb((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCb(
    (message, type) => {
      const id = ++idRef.current;
      setToasts((list) => [...list, { id, message, type }]);
      setTimeout(() => remove(id), 3500);
    },
    [remove]
  );

  const toast = {
    success: (m) => push(m, "success"),
    error: (m) => push(m, "error"),
    info: (m) => push(m, "info"),
  };

  // --- Confirm ---
  const [confirmState, setConfirmState] = useState(null);
  const resolverRef = useRef(null);

  const confirm = useCb((options) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setConfirmState({
        title: options.title || "Är du säker?",
        message: options.message || "",
        confirmLabel: options.confirmLabel || "Bekräfta",
        cancelLabel: options.cancelLabel || "Avbryt",
        danger: options.danger || false,
      });
    });
  }, []);

  function answer(result) {
    if (resolverRef.current) resolverRef.current(result);
    resolverRef.current = null;
    setConfirmState(null);
  }

  return (
    <ToastContext.Provider value={toast}>
      <ConfirmContext.Provider value={confirm}>
        {children}

        {/* Toast-viewport */}
        <div className="toast-viewport">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.type}`}>
              <span className="toast-icon">
                {t.type === "success" ? "✓" : t.type === "error" ? "!" : "i"}
              </span>
              <span>{t.message}</span>
            </div>
          ))}
        </div>

        {/* Confirm-dialog */}
        {confirmState && (
          <div className="modal-overlay" onClick={() => answer(false)}>
            <div
              className="modal confirm-dialog"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ marginTop: 0 }}>{confirmState.title}</h3>
              {confirmState.message && (
                <p className="muted">{confirmState.message}</p>
              )}
              <div className="row" style={{ justifyContent: "flex-end", marginTop: 18 }}>
                <button className="btn-secondary" onClick={() => answer(false)}>
                  {confirmState.cancelLabel}
                </button>
                <button
                  className={confirmState.danger ? "btn-danger" : ""}
                  onClick={() => answer(true)}
                >
                  {confirmState.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        )}
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
}
