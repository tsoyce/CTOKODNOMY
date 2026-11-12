import { useState } from "react";
import type { Brand } from "../../shared/types";
import { api } from "../lib";
import { soundCatalog } from "./BoardSound";
import "./SoundSettings.css";

type SoundKey = (typeof soundCatalog)[number]["key"];

export function SoundSettings({ brand, onChange, disabled, onUploading }: {
  brand: Brand;
  onChange: (brand: Brand) => void;
  disabled: boolean;
  onUploading: (uploading: boolean) => void;
}) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState<SoundKey | null>(null);

  async function upload(key: SoundKey, file: File) {
    setError("");
    if (file.size > 2 * 1024 * 1024 || file.size === 0) {
      setError("Выберите непустой звуковой файл размером до 2 МБ.");
      return;
    }
    setLoading(key);
    onUploading(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const result = await api<{ url: string }>("/media/audio", { method: "POST", body });
      onChange({ ...brand, [key]: result.url });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить звук. Попробуйте ещё раз.");
    } finally {
      onUploading(false);
      setLoading(null);
    }
  }

  const custom = soundCatalog.filter(({ key }) => brand[key]).length;
  return (
    <section aria-labelledby="sound-settings-title" className="brand-editor sound-settings">
      <h2 id="sound-settings-title">Звуки игры</h2>
      <p>Для каждого события можно загрузить свой сигнал или оставить стандартный. Поддерживаются MP3, WAV и OGG до 2 МБ. Своих звуков: {custom} из {soundCatalog.length}.</p>
      <p className="muted">После сохранения выключите и снова включите звук на открытом табло — новые сигналы загрузятся без пересоздания игры.</p>
      <ul className="sound-list">
        {soundCatalog.map(({ key, label, hint }) => (
          <li className={`sound-row ${brand[key] ? "is-custom" : ""}`} key={key}>
            <div className="sound-row-title">
              <strong>{label}</strong>
              <small>{hint}</small>
            </div>
            <span className="sound-row-state">{loading === key ? "Загрузка…" : brand[key] ? "Свой звук" : "Стандартный"}</span>
            {brand[key] && <audio controls preload="none" src={brand[key]} aria-label={`Прослушать: ${label}`} />}
            <div className="sound-row-actions">
              <label className="button button-secondary sound-upload">
                <span>{brand[key] ? "Заменить" : "Загрузить"}</span>
                <input
                  type="file"
                  className="sr-only"
                  accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/ogg,.mp3,.wav,.ogg"
                  disabled={disabled || Boolean(loading)}
                  aria-label={`Загрузить звук: ${label}`}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file) void upload(key, file);
                  }}
                />
              </label>
              {brand[key] && <button type="button" className="button button-ghost" disabled={disabled || Boolean(loading)} onClick={() => onChange({ ...brand, [key]: "" })} aria-label={`Вернуть стандартный: ${label}`}>Сбросить</button>}
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
