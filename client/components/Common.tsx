import { Link } from "react-router-dom";
import { ArrowUpRight, LoaderCircle, Sparkles } from "lucide-react";
import { useSite } from "../lib";
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} /> Загружаем…
    </div>
  );
}
export function ErrorMessage({ message }: { message: string }) {
  return message ? (
    <div className="error" role="alert">
      {message}
    </div>
  ) : null;
}
export function BrandMark() {
  const { site } = useSite();
  return (
    <Link to="/" className="brand-mark" aria-label="На главную">
      {site?.brand.gameLogoUrl || site?.brand.logoUrl ? (
        <img src={site.brand.gameLogoUrl || site.brand.logoUrl} alt="" />
      ) : (
        <span className="brand-icon">
          <Sparkles size={20} />
        </span>
      )}
      <span>
        {site?.brand.title || "100 к 1"}
        {site?.brand.organizer && <small>{site.brand.organizer}</small>}
      </span>
    </Link>
  );
}
export function EmptyState({
  title,
  description,
  href,
  label,
}: {
  title: string;
  description: string;
  href?: string;
  label?: string;
}) {
  return (
    <div className="empty-state">
      <Sparkles size={30} />
      <h3>{title}</h3>
      <p>{description}</p>
      {href && (
        <Link className="button button-primary" to={href}>
          {label || "Продолжить"}
          <ArrowUpRight size={16} />
        </Link>
      )}
    </div>
  );
}
