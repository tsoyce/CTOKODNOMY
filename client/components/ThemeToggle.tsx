import { Moon, Palette, Sun } from "lucide-react";
import { useAppearance, type AppearanceMode } from "../lib";

/** A browser preference; this never changes the event's saved branding. */
export function ThemeToggle() {
  const { mode, setMode } = useAppearance();
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Palette;
  return (
    <label
      className="appearance-control theme-toggle"
      title="Тема только в этом браузере"
    >
      <Icon size={17} aria-hidden="true" />
      <select
        aria-label="Тема интерфейса"
        value={mode}
        onChange={(event) => setMode(event.target.value as AppearanceMode)}
      >
        <option value="light">Светлая</option>
        <option value="dark">Тёмная</option>
        <option value="brand">Тема события</option>
      </select>
    </label>
  );
}
