import {
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ImagePlus,
  Monitor,
  Palette,
  Plus,
  Smartphone,
  Sparkles,
  Trash2,
  Type,
  Upload,
  Users,
} from "lucide-react";
import { defaultBrand, type Brand } from "../../shared/types";
import "./Branding.css";

const imageTypes = ["image/png", "image/jpeg", "image/webp"];
const palettes = [
  {
    name: "Лайм",
    primary: "#7559ff",
    accent: "#edff7a",
    background: "#111222",
    textColor: "#f4f3ff",
  },
  {
    name: "Закат",
    primary: "#ab477f",
    accent: "#ffc08c",
    background: "#211521",
    textColor: "#fff4ee",
  },
  {
    name: "Океан",
    primary: "#247e96",
    accent: "#86edd9",
    background: "#101f2a",
    textColor: "#edf9ff",
  },
  {
    name: "Индиго",
    primary: "#6055c8",
    accent: "#bac1ff",
    background: "#17192c",
    textColor: "#f4f5ff",
  },
] as const;

function completeBrand(brand: Brand): Brand {
  return {
    ...defaultBrand,
    ...brand,
    partnerLogoUrls: brand.partnerLogoUrls ?? [],
  };
}

function luminance(hex: string) {
  const values = [1, 3, 5]
    .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}

function contrastRatio(first: string, second: string) {
  const a = luminance(first),
    b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function PreviewMark({
  brand,
  compact = false,
}: {
  brand: Brand;
  compact?: boolean;
}) {
  return (
    <div className={`brand-demo-mark${compact ? " is-compact" : ""}`}>
      {brand.gameLogoUrl || brand.logoUrl ? (
        <img
          src={brand.gameLogoUrl || brand.logoUrl}
          alt="Логотип в предпросмотре"
        />
      ) : (
        <span className="brand-demo-symbol">
          100<small>к</small>1
        </span>
      )}
      <div>
        <strong>{brand.title}</strong>
        {brand.organizer && <small>{brand.organizer}</small>}
      </div>
    </div>
  );
}

function PreviewPartners({ brand }: { brand: Brand }) {
  return brand.partnerLogoUrls.length ? (
    <div className="brand-demo-partners">
      {brand.partnerLogoUrls.map((url, index) => (
        <img
          key={`${url}-${index}`}
          src={url}
          alt={`Партнёр ${index + 1} в предпросмотре`}
        />
      ))}
    </div>
  ) : null;
}

function PreviewHome({ brand }: { brand: Brand }) {
  return (
    <div className="brand-demo-home">
      <div className="brand-demo-header">
        <PreviewMark brand={brand} />
        <span>
          Как играть <ArrowRight size={12} />
        </span>
      </div>
      <div className="brand-demo-home-body">
        {brand.organizer && (
          <p className="brand-demo-eyebrow">
            <span />
            {brand.organizer}
          </p>
        )}
        {brand.logoUrl && (
          <img
            className="brand-demo-organizer"
            src={brand.logoUrl}
            alt="Логотип организатора в предпросмотре"
          />
        )}
        {brand.heroTitle && <h3>{brand.heroTitle}</h3>}
        {brand.description && (
          <p className="brand-demo-description">{brand.description}</p>
        )}
        <span className="brand-demo-cta">
          Войти в команду <ArrowRight size={14} />
        </span>
        {brand.heroNote && (
          <p className="brand-demo-note">
            <Users size={12} />
            {brand.heroNote}
          </p>
        )}
      </div>
      <PreviewPartners brand={brand} />
      <div className="brand-demo-footer">
        <span>
          {[brand.organizer, brand.footerText].filter(Boolean).join(" · ")}
        </span>
        <span>Правила и помощь</span>
      </div>
    </div>
  );
}

function PreviewBoard({ brand }: { brand: Brand }) {
  return (
    <div className="brand-demo-board">
      <div className="brand-demo-board-header">
        <PreviewMark brand={brand} compact />
        <span className="brand-demo-round">Раунд 1 · ×1</span>
      </div>
      {brand.logoUrl && (
        <img
          className="brand-demo-organizer"
          src={brand.logoUrl}
          alt="Логотип организатора на табло в предпросмотре"
        />
      )}
      <p className="brand-demo-eyebrow">Сто человек ответили</p>
      <h3>Что делает вечер незабываемым?</h3>
      <div className="brand-demo-answer is-open">
        <span>1</span>
        <strong>Хорошая компания</strong>
        <b>36</b>
      </div>
      <div className="brand-demo-answer">
        <span>2</span>
        <strong>••••••••</strong>
        <b>?</b>
      </div>
      <div className="brand-demo-answer">
        <span>3</span>
        <strong>••••••••</strong>
        <b>?</b>
      </div>
      <div className="brand-demo-scores">
        <div>
          Команда 1 <strong>120</strong>
        </div>
        <span>
          Банк <b>36</b>
        </span>
        <div>
          Команда 2 <strong>85</strong>
        </div>
      </div>
      <PreviewPartners brand={brand} />
    </div>
  );
}

function PreviewPhone({ brand }: { brand: Brand }) {
  return (
    <div className="brand-demo-phone-wrap">
      <div className="brand-demo-phone">
        <div className="brand-demo-phone-speaker" />
        <PreviewMark brand={brand} compact />
        <div className="brand-demo-player">
          <span>М</span>
          <div>
            <strong>Моя команда</strong>
            <small>Вы участник</small>
          </div>
          <b>120</b>
        </div>
        <p className="brand-demo-eyebrow">Обсуждаем вместе</p>
        <h3>Что делает вечер незабываемым?</h3>
        <p className="brand-demo-description">
          Предложите вариант. Капитан выберет ответ команды.
        </p>
        <div className="brand-demo-input">Мой вариант…</div>
        <span className="brand-demo-cta">
          Предложить ответ <ArrowRight size={13} />
        </span>
        <div className="brand-demo-suggestion">
          <span>А</span>
          <div>
            <small>Аня</small>
            <strong>Хорошая компания</strong>
          </div>
        </div>
        <div className="brand-demo-footer">{brand.footerText}</div>
      </div>
    </div>
  );
}

export function BrandPreview({ brand: source }: { brand: Brand }) {
  const brand = completeBrand(source);
  const [tab, setTab] = useState(0);
  const tabs = [
    { label: "Главная", icon: <Sparkles size={15} /> },
    { label: "Табло", icon: <Monitor size={15} /> },
    { label: "Телефон", icon: <Smartphone size={15} /> },
  ];
  const id = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const ratio = contrastRatio(brand.background, brand.textColor);
  const style = {
    "--demo-bg": brand.background,
    "--demo-text": brand.textColor,
    "--demo-primary": brand.primary,
    "--demo-accent": brand.accent,
    "--demo-accent-text":
      contrastRatio(brand.accent, "#151620") >= 4.5 ? "#151620" : "#ffffff",
  } as CSSProperties;
  return (
    <section className="brand-preview" aria-label="Предпросмотр оформления">
      <div className="brand-preview-heading">
        <div>
          <p className="brand-section-kicker">Результат сразу</p>
          <h2>Предпросмотр</h2>
        </div>
        <span className="brand-preview-live">
          <span />В реальном времени
        </span>
      </div>
      <p className="brand-section-description">
        Посмотрите на игру глазами гостей и участников.
      </p>
      <div
        className="brand-preview-tabs"
        role="tablist"
        aria-label="Экран предпросмотра"
      >
        {tabs.map(({ label, icon }, index) => (
          <button
            key={label}
            id={`${id}-tab-${index}`}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            type="button"
            role="tab"
            aria-selected={index === tab}
            aria-controls={`${id}-panel`}
            tabIndex={index === tab ? 0 : -1}
            onClick={() => setTab(index)}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % tabs.length
                  : event.key === "ArrowLeft"
                    ? (index + tabs.length - 1) % tabs.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? tabs.length - 1
                        : null;
              if (next !== null) {
                event.preventDefault();
                setTab(next);
                tabRefs.current[next]?.focus();
              }
            }}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>
      <div
        className="brand-demo"
        style={style}
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${tab}`}
        tabIndex={0}
      >
        {tab === 0 ? (
          <PreviewHome brand={brand} />
        ) : tab === 1 ? (
          <PreviewBoard brand={brand} />
        ) : (
          <PreviewPhone brand={brand} />
        )}
      </div>
      <p className={`brand-contrast${ratio < 4.5 ? " is-low" : ""}`}>
        <Check size={14} />
        <span>
          {ratio >= 4.5
            ? "Текст хорошо читается на фоне."
            : "Тексту нужен больший контраст с фоном."}
          <small>
            Контраст {ratio.toFixed(1)}:1
            {ratio < 4.5 ? " · попробуйте другую палитру" : ""}
          </small>
        </span>
      </p>
      <p className="brand-preview-caption">
        Пример с вымышленными ответами и очками.
      </p>
    </section>
  );
}

function EditorSection({
  number,
  title,
  description,
  icon,
  children,
}: {
  number: string;
  title: string;
  description: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="brand-editor-section">
      <div className="brand-editor-section-heading">
        <span className="brand-section-icon">{icon}</span>
        <div>
          <p className="brand-section-kicker">{number}</p>
          <h2>{title}</h2>
        </div>
      </div>
      <p className="brand-section-description">{description}</p>
      {children}
    </section>
  );
}

function LogoCard({
  label,
  note,
  value,
  disabled,
  loading,
  onUpload,
  onRemove,
  square = false,
}: {
  label: string;
  note: string;
  value: string;
  disabled: boolean;
  loading: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
  square?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`brand-logo-card${square ? " is-square" : ""}`}
      data-logo={label}
    >
      <div className="brand-logo-thumbnail">
        {value ? <img src={value} alt={label} /> : <ImagePlus size={28} />}
        {!value && <span>{square ? "1:1" : "Ваш логотип"}</span>}
      </div>
      <div className="brand-logo-content">
        <strong>{label}</strong>
        <p>{note}</p>
        <div className="brand-logo-actions">
          <button
            type="button"
            disabled={disabled}
            className="button button-secondary button-small"
            onClick={() => input.current?.click()}
          >
            <Upload size={14} />
            {loading ? "Загружаем…" : value ? "Заменить" : "Загрузить"}
          </button>
          {value && (
            <button
              type="button"
              disabled={disabled}
              className="brand-remove"
              onClick={onRemove}
              aria-label={`Убрать: ${label}`}
            >
              <Trash2 size={15} />
              Убрать
            </button>
          )}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        hidden
        aria-label={label}
        accept="image/png,image/jpeg,image/webp"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onUpload(file);
          event.target.value = "";
        }}
      />
    </div>
  );
}

export function BrandEditor({
  brand: source,
  onChange,
  uploadImage,
  disabled = false,
}: {
  brand: Brand;
  onChange: (brand: Brand) => void;
  uploadImage: (file: File) => Promise<string>;
  disabled?: boolean;
}) {
  const brand = completeBrand(source);
  const [uploading, setUploading] = useState("");
  const [uploadError, setUploadError] = useState("");
  const partnerInput = useRef<HTMLInputElement>(null);
  const locked = disabled || Boolean(uploading);
  const update = <K extends keyof Brand>(key: K, value: Brand[K]) =>
    onChange({ ...brand, [key]: value });
  const upload = async (
    file: File,
    target: "logoUrl" | "gameLogoUrl" | "faviconUrl" | "partnerLogoUrls",
  ) => {
    setUploadError("");
    if (!imageTypes.includes(file.type)) {
      setUploadError("Выберите изображение в формате PNG, JPG или WebP.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setUploadError(
        "Изображение слишком большое. Максимальный размер — 2 МБ.",
      );
      return;
    }
    setUploading(target);
    try {
      const url = await uploadImage(file);
      update(
        target,
        target === "partnerLogoUrls" ? [...brand.partnerLogoUrls, url] : url,
      );
    } catch (error) {
      setUploadError(
        error instanceof Error
          ? error.message
          : "Не удалось загрузить изображение. Попробуйте ещё раз.",
      );
    } finally {
      setUploading("");
    }
  };
  return (
    <div className="brand-editor">
      <EditorSection
        number="01 / Слова"
        title="Игра с вашим характером"
        description="Назовите игру и мероприятие. Любое поле, кроме названия игры, можно оставить пустым."
        icon={<Type size={21} />}
      >
        <div className="brand-fields-grid">
          <label className="field">
            Название игры
            <input
              required
              maxLength={150}
              value={brand.title}
              disabled={locked}
              onChange={(event) => update("title", event.target.value)}
              placeholder="100 к 1"
            />
          </label>
          <label className="field">
            Организатор
            <input
              maxLength={150}
              value={brand.organizer}
              disabled={locked}
              onChange={(event) => update("organizer", event.target.value)}
              placeholder="Название мероприятия или команды"
            />
          </label>
        </div>
        <label className="field">
          Описание
          <textarea
            aria-label="Описание"
            rows={3}
            maxLength={1000}
            value={brand.description}
            disabled={locked}
            onChange={(event) => update("description", event.target.value)}
            placeholder="О чём эта игра и для кого вы её проводите?"
          />
        </label>
        <details className="brand-copy-details" open>
          <summary>
            Надписи на главной странице <ChevronDown size={16} />
          </summary>
          <div className="brand-copy-fields">
            <label className="field">
              Заголовок главной
              <textarea
                aria-label="Заголовок главной"
                rows={2}
                maxLength={200}
                value={brand.heroTitle}
                disabled={locked}
                onChange={(event) => update("heroTitle", event.target.value)}
                placeholder="Вместе знаем больше."
              />
            </label>
            <label className="field">
              Подпись на главной
              <input
                maxLength={300}
                value={brand.heroNote}
                disabled={locked}
                onChange={(event) => update("heroNote", event.target.value)}
                placeholder="Для игроков и гостей. Прямо в браузере."
              />
            </label>
            <label className="field">
              Текст внизу страницы
              <input
                maxLength={300}
                value={brand.footerText}
                disabled={locked}
                onChange={(event) => update("footerText", event.target.value)}
                placeholder="Играем вместе"
              />
            </label>
          </div>
        </details>
      </EditorSection>
      <EditorSection
        number="02 / Изображения"
        title="Логотипы на своих местах"
        description="Загрузите готовые файлы: PNG, JPG или WebP, до 2 МБ каждый. Лучше всего выглядят логотипы с прозрачным фоном."
        icon={<ImagePlus size={21} />}
      >
        <div className="brand-logo-grid">
          <LogoCard
            label="Логотип игры"
            note="В шапке сайта, командной комнате и на табло."
            value={brand.gameLogoUrl}
            disabled={locked}
            loading={uploading === "gameLogoUrl"}
            onUpload={(file) => void upload(file, "gameLogoUrl")}
            onRemove={() => update("gameLogoUrl", "")}
          />
          <LogoCard
            label="Логотип организатора"
            note="На главной странице и общем экране."
            value={brand.logoUrl}
            disabled={locked}
            loading={uploading === "logoUrl"}
            onUpload={(file) => void upload(file, "logoUrl")}
            onRemove={() => update("logoUrl", "")}
          />
          <LogoCard
            label="Значок сайта"
            note="Квадратное изображение для вкладки браузера."
            value={brand.faviconUrl}
            disabled={locked}
            loading={uploading === "faviconUrl"}
            onUpload={(file) => void upload(file, "faviconUrl")}
            onRemove={() => update("faviconUrl", "")}
            square
          />
        </div>
        <div className="brand-partners-heading">
          <div>
            <h3>Партнёры мероприятия</h3>
            <p>Покажем их логотипы на главной, в ожидании и итогах игры.</p>
          </div>
          <span>{brand.partnerLogoUrls.length}/12</span>
        </div>
        <div className="brand-partner-grid">
          {brand.partnerLogoUrls.map((url, index) => (
            <div className="brand-partner-card" key={`${url}-${index}`}>
              <img src={url} alt={`Логотип партнёра ${index + 1}`} />
              <button
                type="button"
                disabled={locked}
                className="brand-partner-remove"
                aria-label={`Убрать логотип партнёра ${index + 1}`}
                onClick={() =>
                  update(
                    "partnerLogoUrls",
                    brand.partnerLogoUrls.filter((_, i) => i !== index),
                  )
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {brand.partnerLogoUrls.length < 12 && (
            <button
              type="button"
              className="brand-partner-add"
              disabled={locked}
              onClick={() => partnerInput.current?.click()}
            >
              <Plus size={22} />
              <span>
                {uploading === "partnerLogoUrls"
                  ? "Загружаем…"
                  : "Добавить логотип"}
              </span>
            </button>
          )}
        </div>
        <input
          ref={partnerInput}
          type="file"
          hidden
          aria-label="Логотипы партнёров"
          accept="image/png,image/jpeg,image/webp"
          disabled={locked || brand.partnerLogoUrls.length >= 12}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file, "partnerLogoUrls");
            event.target.value = "";
          }}
        />
        {uploadError && (
          <p className="brand-upload-error" role="alert">
            {uploadError}
          </p>
        )}
        {uploading && (
          <span className="brand-upload-status" role="status">
            Загружаем изображение…
          </span>
        )}
      </EditorSection>
      <EditorSection
        number="03 / Цвет"
        title="Выберите настроение"
        description="Начните с готовой палитры или задайте свои цвета. Результат сразу виден в предпросмотре."
        icon={<Palette size={21} />}
      >
        <div className="brand-palettes">
          {palettes.map((palette) => {
            const selected = (
              ["primary", "accent", "background", "textColor"] as const
            ).every(
              (key) => brand[key].toLowerCase() === palette[key].toLowerCase(),
            );
            return (
              <button
                type="button"
                key={palette.name}
                disabled={locked}
                className={`brand-palette${selected ? " is-selected" : ""}`}
                aria-pressed={selected}
                onClick={() =>
                  onChange({
                    ...brand,
                    primary: palette.primary,
                    accent: palette.accent,
                    background: palette.background,
                    textColor: palette.textColor,
                  })
                }
              >
                <span
                  className="brand-palette-sample"
                  style={{ background: palette.background }}
                >
                  <i style={{ background: palette.primary }} />
                  <i style={{ background: palette.accent }} />
                  <i style={{ background: palette.textColor }} />
                </span>
                <span>
                  {palette.name}
                  {selected && <Check size={13} />}
                </span>
              </button>
            );
          })}
        </div>
        <div className="brand-color-grid">
          {(
            [
              ["primary", "Основной цвет"],
              ["accent", "Акцентный цвет"],
              ["background", "Цвет фона"],
              ["textColor", "Цвет текста"],
            ] as const
          ).map(([key, label]) => (
            <label className="brand-color" key={key}>
              <input
                type="color"
                value={brand[key]}
                disabled={locked}
                onChange={(event) => update(key, event.target.value)}
                aria-label={label}
              />
              <span>
                <strong>{label}</strong>
                <small>{brand[key].toUpperCase()}</small>
              </span>
            </label>
          ))}
        </div>
      </EditorSection>
    </div>
  );
}
