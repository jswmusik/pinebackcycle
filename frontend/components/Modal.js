"use client";

import { useEffect } from "react";

export default function Modal({ title, onClose, children, maxWidth }) {
  // Stäng med Escape + lås bakgrundens scroll (undviker dubbla scrollfält).
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    // Klick utanför stänger INTE modalen (lätt att råka klicka bort sitt arbete).
    // Stäng med ×-knappen eller Escape.
    <div className="modal-overlay">
      <div className="modal" style={maxWidth ? { maxWidth } : undefined}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Stäng">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
