import { useState } from "react";
import type { Brand } from "../../shared/types";
import { api } from "../lib";
import "./SoundSettings.css";

type SoundKey = "soundCorrectUrl" | "soundWrongUrl" | "soundBankUrl" | "soundRepeatUrl";
const sounds: Array<{ key: SoundKey; label: string }> = [
  { key: "soundCorrectUrl", label: "Правильный ответ" },
  { key: "soundWrongUrl", label: "Ошибка" },
  { key: "soundBankUrl", label: "Банк присуждён" },
  { key: "soundRepeatUrl", label: "Повтор ответа в финале" },
];

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

  return (
    <section aria-labelledby="sound-settings-title" className="brand-editor sound-settings">
      <h2 id="sound-settings-title">Звуки игры</h2>
      <p>Загрузите свои сигналы или оставьте стандартные. Поддерживаются MP3, WAV и OGG до 2 МБ.</p>
      <p className="muted">После сохранения выключите и снова включите звук на открытом табло — новые сигналы загрузятся без пересоздания игры.</p>
      <div className="brand-fields-grid">
        {sounds.map(({ key, label }) => (
          <div className="field" key={key}>
            <strong>{label}</strong>
            <span>{brand[key] ? "Загружен свой звук" : "Стандартный сигнал"}</span>
            {brand[key] && <audio controls preload="none" src={brand[key]} aria-label={`Прослушать: ${label}`} />}
            <label>
              <span>{loading === key ? "Загрузка…" : brand[key] ? "Заменить файл" : "Выбрать файл"}</span>
              <input
                type="file"
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
            {brand[key] && <button type="button" className="button button-ghost" disabled={disabled || Boolean(loading)} onClick={() => onChange({ ...brand, [key]: "" })}>Вернуть стандартный</button>}
          </div>
        ))}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
