import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { FileQuestion } from "lucide-react";
import type { Answer } from "../../shared/types";
import { boardAnswers } from "../../shared/questionAnswers";
import { api } from "../lib";

export const messageOf = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Не удалось выполнить действие. Попробуйте ещё раз.";
export const json = (method: string, data?: unknown): RequestInit => ({
  method,
  ...(data === undefined
    ? {}
    : {
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
});
export const answerSummary = (answers: Answer[]) =>
  `${boardAnswers(answers).length} на табло · ${answers.length} в статистике`;

export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}

export function EmptyState({
  icon = <FileQuestion size={32} />,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h2>{title}</h2>
      <p className="muted">{children}</p>
      {action}
    </div>
  );
}

export function useResource<T>(path: string) {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      const next = await api<T>(path);
      if (generation.current === current) {
        setValue(next);
        setError("");
      }
      return next;
    } catch (err) {
      if (generation.current === current) setError(messageOf(err));
      return null;
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    setValue(null);
    setLoading(true);
    void refresh();
    return () => {
      generation.current++;
    };
  }, [refresh]);
  const replace = useCallback((next: T) => {
    generation.current++;
    setValue(next);
  }, []);
  return { value, setValue: replace, error, setError, loading, refresh };
}
