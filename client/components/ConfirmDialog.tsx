import { useEffect, useId, useRef, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import "./ConfirmDialog.css";

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  busy = false,
  error,
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  error?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    cancel.current?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
      if (
        previouslyFocused instanceof HTMLElement &&
        previouslyFocused.isConnected
      )
        previouslyFocused.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="confirm-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <div id={descriptionId} className="confirm-dialog-description">
        {description}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="confirm-dialog-actions">
        <button
          ref={cancel}
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Отмена
        </button>
        <button
          type="button"
          className={`button ${danger ? "button-danger" : "button-primary"}`}
          disabled={busy}
          onClick={onConfirm}
        >
          {busy && <LoaderCircle size={18} className="spin" />}
          {busy ? "Подождите…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
