"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Модальное окно на нативном <dialog>: фокус, Escape и подложка — от браузера, без библиотек (ADR-014).
 * Открытие и закрытие управляются извне флагом `open`; закрытие любым способом (Escape, подложка, кнопка)
 * приходит родителю одним событием `onClose`, чтобы состояние не расходилось с экраном.
 */

interface ModalProps {
  open: boolean;
  title: string;
  closeLabel: string;
  onClose: () => void;
  /** Широкое окно — для двух колонок сравнения. */
  wide?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ open, title, closeLabel, onClose, wide, children, footer }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`modal${wide ? " modal--wide" : ""}`}
      aria-label={title}
      onClose={onClose}
      // Клик по подложке: цель события — сам <dialog>, клики по содержимому приходят от его потомков.
      onClick={(event) => {
        if (event.target === ref.current) ref.current.close();
      }}
    >
      <div className="modal__panel">
        <header className="modal__header">
          <h2 className="modal__title">{title}</h2>
          <button type="button" className="modal__close" onClick={() => ref.current?.close()} aria-label={closeLabel}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer ? <footer className="modal__footer">{footer}</footer> : null}
      </div>
    </dialog>
  );
}
