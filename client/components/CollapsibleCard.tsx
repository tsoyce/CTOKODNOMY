import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import "./CollapsibleCard.css";

interface CollapsibleCardProps {
  header: ReactNode;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
  id?: string;
}

/** Keep fields mounted while a native keyboard-accessible disclosure is closed. */
export function CollapsibleCard({ header, children, className = "", defaultOpen = true, id }: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <details
      id={id}
      className={`collapsible-card ${className}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onInvalidCapture={(event) => {
        // Reveal a required field before the browser tries to focus it.
        event.currentTarget.open = true;
        setOpen(true);
      }}
    >
      <summary className="collapsible-card-heading" aria-controls={bodyId}>
        <div className="collapsible-card-title">{header}</div>
        <ChevronDown className="collapsible-card-chevron" size={20} aria-hidden="true" />
      </summary>
      <div id={bodyId} className="collapsible-card-body">{children}</div>
    </details>
  );
}
