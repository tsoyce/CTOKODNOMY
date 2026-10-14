import {
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  ChevronLeft,
  Check,
  ClipboardList,
  Gamepad2,
  KeyRound,
  Monitor,
  ShieldCheck,
  Sparkles,
  Users,
  Wifi,
} from "lucide-react";
import { defaultBrand, type Brand, type Me } from "../../shared/types";
import { api, useMe, useSite } from "../lib";
import { BrandMark, ErrorMessage } from "../components/Common";

function PublicFrame({
  children,
  compact = false,
}: {
  children: ReactNode;
  compact?: boolean;
}) {
  const { me } = useMe();
  const { site } = useSite();
  return (
    <div className={`public-page ${compact ? "public-page-compact" : ""}`}>
      <header className="public-header container">
        <div className="brand-link">
          <BrandMark />
        </div>
        <nav aria-label="Основная навигация">
          <Link to="/help">Как играть</Link>
          <Link
            className="button secondary small"
            to={me?.admin ? "/admin" : "/login"}
          >
            {me?.admin ? "Админка" : "Ведущему"} <ArrowRight size={16} />
          </Link>
        </nav>
      </header>
      {children}
      <footer className="public-footer container">
        <span>{site?.brand.organizer || "День социолога"} · Играем вместе</span>
        <Link to="/help">Правила и помощь</Link>
      </footer>
    </div>
  );
}

const phaseLabels = {
  lobby: "Скоро начинаем",
  playing: "Игра идёт",
  steal: "Перехват",
  "round-result": "Между раундами",
  finished: "Итоги игры",
};

function contrastRatio(first: string, second: string) {
  function luminance(hex: string) {
    const channels = [1, 3, 5]
      .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((value) =>
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
      );
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function HomePage() {
  const { site } = useSite();
  const { me } = useMe();
  const brand = site?.brand ?? defaultBrand;
  const games = site?.games ?? [];
  const activeGames = games.filter((game) => game.phase !== "finished");
  const gameToWatch = activeGames[0] ?? games[0];
  return (
    <PublicFrame>
      <main>
        <section className="hero container">
          <div className="hero-content">
            <p className="hero-eyebrow">
              <span className="status-dot" />{" "}
              {brand.organizer || "День социолога"}
            </p>
            <h1 className="hero-title">
              Вместе знаем
              <br />
              <span>больше.</span>
            </h1>
            <p className="hero-description">
              {brand.description ||
                "Один вопрос. Множество мнений. Соберите команду и угадайте самые популярные ответы."}
            </p>
            <div className="hero-actions">
              <Link to="/join" className="button primary">
                Войти в команду <ArrowRight size={19} />
              </Link>
              {gameToWatch && (
                <Link
                  to={`/board/${gameToWatch.id}`}
                  className="button secondary"
                >
                  <Monitor size={18} /> Смотреть игру
                </Link>
              )}
            </div>
            <p className="hero-note">
              <Users size={16} /> Для игроков и гостей. Прямо в браузере.
            </p>
            {me?.participant && (
              <Link
                className="resume-link"
                to={`/team/${me.participant.gameId}`}
              >
                Вернуться в свою команду <ArrowRight size={16} />
              </Link>
            )}
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="hero-orbit orbit-one" />
            <div className="hero-orbit orbit-two" />
            <div className="hero-art-caption">
              <Sparkles size={16} /> Самые популярные ответы
            </div>
            <div className="hero-game-mark">
              <span>100</span>
              <small>к</small>
              <span>1</span>
            </div>
            <div className="hero-answer-stack">
              <div className="preview-answer">
                <span className="answer-number">01</span>
                <span>Один вопрос</span>
                <Check size={21} />
              </div>
              <div className="preview-answer">
                <span className="answer-number">02</span>
                <span>Две команды</span>
                <Users size={21} />
              </div>
              <div className="preview-answer">
                <span className="answer-number">03</span>
                <span>Сотни мнений</span>
                <Sparkles size={21} />
              </div>
            </div>
            <div className="hero-sticker">А что ответишь ты?</div>
          </div>
        </section>

        <section
          className="container features-section"
          aria-labelledby="roles-title"
        >
          <div className="section-title">
            <div>
              <p className="eyebrow">Ваша роль в игре</p>
              <h2 id="roles-title">Для каждого есть место</h2>
            </div>
            <span className="muted">Без установки приложений</span>
          </div>
          <div className="feature-grid">
            <Link className="feature-card" to="/join">
              <div className="feature-icon">
                <Gamepad2 size={24} />
              </div>
              <h3>В команде</h3>
              <p>
                Предлагайте варианты на телефоне. Капитан выберет общий ответ.
              </p>
              <span className="text-link">
                Ввести код команды <ArrowRight size={17} />
              </span>
            </Link>
            <Link
              className="feature-card"
              to={gameToWatch ? `/board/${gameToWatch.id}` : "/help"}
            >
              <div className="feature-icon lime">
                <Monitor size={24} />
              </div>
              <h3>В зале</h3>
              <p>
                Следите за ответами и счётом на большом экране. Болейте за
                своих!
              </p>
              <span className="text-link">
                {gameToWatch ? "Открыть табло" : "Как проходит игра"}{" "}
                <ArrowRight size={17} />
              </span>
            </Link>
            <Link className="feature-card" to={me?.admin ? "/admin" : "/login"}>
              <div className="feature-icon pink">
                <ClipboardList size={24} />
              </div>
              <h3>За пультом</h3>
              <p>
                Подготовьте вопросы, пригласите команды и управляйте каждым
                раундом.
              </p>
              <span className="text-link">
                {me?.admin ? "К подготовке игры" : "Вход ведущего"}{" "}
                <ArrowRight size={17} />
              </span>
            </Link>
          </div>
        </section>

        <section
          className="container live-section"
          aria-labelledby="games-title"
        >
          <div className="section-title">
            <div>
              <p className="eyebrow">На общем экране</p>
              <h2 id="games-title">
                {activeGames.length
                  ? "Присоединяйтесь к событию"
                  : "До встречи в игре"}
              </h2>
            </div>
            <Wifi size={24} />
          </div>
          {games.length ? (
            <div className="game-list">
              {games.map((game) => (
                <Link
                  className="game-entry"
                  to={`/board/${game.id}`}
                  key={game.id}
                >
                  <div>
                    <span
                      className={`badge ${game.phase === "playing" || game.phase === "steal" ? "live" : ""}`}
                    >
                      {phaseLabels[game.phase]}
                    </span>
                    <h3>{game.title}</h3>
                    <p>{game.teams.map((team) => team.name).join(" · ")}</p>
                  </div>
                  <span className="game-entry-action">
                    {game.phase === "finished" ? "Результаты" : "Открыть табло"}{" "}
                    <ArrowRight size={20} />
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-state lobby-empty">
              <Monitor size={32} />
              <h3>
                {site?.initialized === false
                  ? "Мероприятие готовится"
                  : "Здесь появится общая доска"}
              </h3>
              <p>
                Когда ведущий подготовит игру, её табло будет доступно гостям.
                Игроки смогут войти по приглашению команды.
              </p>
              {site?.initialized === false && (
                <Link className="text-link" to="/setup">
                  Первый запуск для организатора <ArrowRight size={16} />
                </Link>
              )}
            </div>
          )}
        </section>
      </main>
    </PublicFrame>
  );
}

export function SetupPage() {
  const { site, refresh: refreshSite } = useSite();
  const { refresh: refreshMe } = useMe();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordRepeat, setPasswordRepeat] = useState("");
  const [brand, setBrand] = useState<Brand>({ ...defaultBrand });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (site?.initialized)
    return (
      <PublicFrame compact>
        <main className="container auth-page">
          <div className="card auth-card">
            <div className="feature-icon lime">
              <ShieldCheck size={28} />
            </div>
            <h1>Всё уже настроено</h1>
            <p className="muted">
              Первый запуск завершён. Войдите в админку, чтобы подготовить игру
              или изменить оформление.
            </p>
            <Link to="/login" className="button primary">
              Войти <ArrowRight size={18} />
            </Link>
          </div>
        </main>
      </PublicFrame>
    );

  function next(event: FormEvent) {
    event.preventDefault();
    if (step === 0 && password !== passwordRepeat) {
      setError("Пароли не совпадают. Проверьте оба поля.");
      return;
    }
    setError("");
    setStep(step + 1);
  }
  async function finish(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api<Me>("/setup", {
        method: "POST",
        body: JSON.stringify({
          token: token.trim(),
          username: username.trim(),
          password,
          brand,
        }),
      });
      setToken("");
      setPassword("");
      setPasswordRepeat("");
      await Promise.all([refreshMe(), refreshSite()]);
      navigate("/admin", { replace: true });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Не удалось завершить настройку. Попробуйте ещё раз.",
      );
    } finally {
      setBusy(false);
    }
  }
  const previewStyle = {
    "--primary": brand.primary,
    "--accent": brand.accent,
    background: brand.background,
    color: brand.textColor,
  } as CSSProperties;
  return (
    <PublicFrame compact>
      <main className="container setup-page" data-step={step}>
        <div className="page-header">
          <p className="eyebrow">Первый запуск</p>
          <h1>Всё начинается с вас</h1>
          <p className="muted">
            Создайте доступ организатора и задайте настроение будущей игре.
          </p>
        </div>
        <ol className="step-indicator">
          {["Организатор", "Мероприятие", "Предпросмотр"].map(
            (label, index) => (
              <li
                className={
                  index === step ? "active" : index < step ? "done" : ""
                }
                key={label}
              >
                <span>{index < step ? <Check size={15} /> : index + 1}</span>
                {label}
              </li>
            ),
          )}
        </ol>
        <div className="setup-layout">
          <section className="card setup-form">
            <ErrorMessage message={error} />
            {step === 0 && (
              <form className="stack" onSubmit={next}>
                <div>
                  <h2>Ваш доступ к управлению</h2>
                  <p className="muted">
                    Одноразовый код выдаётся оператором на сервере и действует
                    ограниченное время.
                  </p>
                </div>
                <label className="field">
                  Код первого запуска
                  <input
                    required
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    autoComplete="off"
                    type="password"
                    placeholder="Код от оператора"
                  />
                  <small>Этот код нужен только для первой настройки.</small>
                </label>
                <label className="field">
                  Логин организатора
                  <input
                    required
                    minLength={3}
                    maxLength={60}
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    autoComplete="username"
                    placeholder="Например, organizer"
                  />
                </label>
                <label className="field">
                  Пароль
                  <input
                    required
                    minLength={12}
                    maxLength={128}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                    type="password"
                  />
                  <small>
                    Не менее 12 символов. Сохраните пароль в менеджере паролей.
                  </small>
                </label>
                <label className="field">
                  Повторите пароль
                  <input
                    required
                    minLength={12}
                    value={passwordRepeat}
                    onChange={(event) => setPasswordRepeat(event.target.value)}
                    autoComplete="new-password"
                    type="password"
                  />
                </label>
                <button className="button primary" type="submit">
                  Далее: мероприятие <ArrowRight size={18} />
                </button>
              </form>
            )}
            {step === 1 && (
              <form className="stack" onSubmit={next}>
                <div>
                  <h2>Название и настроение</h2>
                  <p className="muted">
                    Оформление объединит главный экран, пульт и телефоны
                    участников. Его можно изменить позже.
                  </p>
                </div>
                <label className="field">
                  Название игры
                  <input
                    required
                    maxLength={120}
                    value={brand.title}
                    onChange={(event) =>
                      setBrand({ ...brand, title: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  Организатор
                  <input
                    required
                    maxLength={120}
                    value={brand.organizer}
                    onChange={(event) =>
                      setBrand({ ...brand, organizer: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  Описание
                  <textarea
                    maxLength={500}
                    rows={3}
                    value={brand.description}
                    onChange={(event) =>
                      setBrand({ ...brand, description: event.target.value })
                    }
                  />
                </label>
                <div className="form-grid color-fields">
                  {(
                    [
                      ["primary", "Основной цвет"],
                      ["accent", "Акцент"],
                      ["background", "Фон"],
                      ["textColor", "Текст"],
                    ] as const
                  ).map(([key, label]) => (
                    <label className="field" key={key}>
                      {label}
                      <div className="color-input">
                        <input
                          aria-label={label}
                          type="color"
                          value={brand[key]}
                          onChange={(event) =>
                            setBrand({ ...brand, [key]: event.target.value })
                          }
                        />
                        <span>{brand[key]}</span>
                      </div>
                    </label>
                  ))}
                </div>
                {contrastRatio(brand.background, brand.textColor) < 4.5 && (
                  <p className="notice" role="status">
                    Текст и фон сливаются: контраст{" "}
                    {contrastRatio(brand.background, brand.textColor).toFixed(
                      1,
                    )}
                    :1. Для чтения из зала рекомендуем не менее 4,5:1. Сделайте
                    фон темнее или текст светлее.
                  </p>
                )}
                <p className="form-hint">
                  Логотипы и значок сайта можно загрузить после установки в
                  разделе «Оформление».
                </p>
                <div className="button-row">
                  <button
                    className="button ghost"
                    type="button"
                    onClick={() => setStep(0)}
                  >
                    <ChevronLeft size={18} /> Назад
                  </button>
                  <button className="button primary" type="submit">
                    Предпросмотр <ArrowRight size={18} />
                  </button>
                </div>
              </form>
            )}
            {step === 2 && (
              <form className="stack" onSubmit={finish}>
                <div className="feature-icon lime">
                  <Check size={26} />
                </div>
                <h2>Можно начинать</h2>
                <p className="muted">
                  Проверьте оформление справа. После завершения настройки вы
                  попадёте в админку и сможете создать первую игру.
                </p>
                <div className="summary-list">
                  <div>
                    <span>Организатор</span>
                    <strong>{username}</strong>
                  </div>
                  <div>
                    <span>Название</span>
                    <strong>{brand.title}</strong>
                  </div>
                  <div>
                    <span>Мероприятие</span>
                    <strong>{brand.organizer}</strong>
                  </div>
                </div>
                <p className="form-hint">
                  <ShieldCheck size={17} /> Одноразовый код будет погашен, а
                  повторная установка — закрыта.
                </p>
                <div className="button-row">
                  <button
                    className="button ghost"
                    type="button"
                    disabled={busy}
                    onClick={() => setStep(1)}
                  >
                    <ChevronLeft size={18} /> Назад
                  </button>
                  <button
                    className="button primary"
                    disabled={busy}
                    type="submit"
                  >
                    {busy ? "Сохраняем…" : "Завершить настройку"}{" "}
                    {!busy && <Check size={18} />}
                  </button>
                </div>
              </form>
            )}
          </section>
          <aside className="setup-preview-wrap">
            <p className="eyebrow">Предпросмотр оформления</p>
            <div className="setup-preview" style={previewStyle}>
              <div className="preview-topline">{brand.organizer}</div>
              <h2>{brand.title || "Ваша игра"}</h2>
              <p>{brand.description}</p>
              <div className="preview-board-label">
                Пример экрана · без игровых данных
              </div>
              <div className="preview-answer">
                <span>1</span>
                <strong>Открытый ответ</strong>
                <span>✓</span>
              </div>
              <div className="preview-answer closed">
                <span>2</span>
                <strong>Скрытый ответ</strong>
                <span>?</span>
              </div>
              <div className="preview-answer closed">
                <span>3</span>
                <strong>Скрытый ответ</strong>
                <span>?</span>
              </div>
              <div className="preview-team-row">
                <span>Команда А</span>
                <span>Команда Б</span>
              </div>
            </div>
            <p className="form-hint">
              Выбирайте контрастные цвета: табло должно читаться с последнего
              ряда.
            </p>
          </aside>
        </div>
      </main>
    </PublicFrame>
  );
}

export function LoginPage() {
  const { me, refresh } = useMe();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const returnTo = params.get("returnTo") ?? "/admin";
  const safeReturnTo = /^\/(?:admin(?:\/|$)|host\/)[A-Za-z0-9_/?=&.-]*$/.test(
    returnTo,
  )
    ? returnTo
    : "/admin";
  if (me?.admin) return <Navigate to={safeReturnTo} replace />;
  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api<Me>("/login", {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password }),
      });
      setPassword("");
      await refresh();
      navigate(safeReturnTo, { replace: true });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Не удалось войти. Проверьте логин и пароль.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <PublicFrame compact>
      <main className="container auth-page">
        <div className="card auth-card">
          <div className="feature-icon">
            <KeyRound size={27} />
          </div>
          <p className="eyebrow">За пультом</p>
          <h1>Вход организатора</h1>
          <p className="muted">Всё для подготовки и проведения вашей игры.</p>
          <form className="stack" onSubmit={login}>
            <ErrorMessage message={error} />
            <label className="field">
              Логин
              <input
                required
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label className="field">
              Пароль
              <input
                required
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button className="button primary" disabled={busy}>
              {busy ? "Входим…" : "Войти"} {!busy && <ArrowRight size={18} />}
            </button>
          </form>
          <details className="help-details">
            <summary>Не получается войти?</summary>
            <p>
              Проверьте раскладку клавиатуры. Если пароль утрачен, обратитесь к
              владельцу сервера: он может восстановить доступ по инструкции
              оператора. Почтовый сброс пароля пока не настроен.
            </p>
            <Link to="/help">Открыть помощь</Link>
          </details>
          <div className="auth-divider" />
          <p className="muted">Вы игрок? Для входа нужен только код команды.</p>
          <Link className="text-link" to="/join">
            Войти в команду <ArrowRight size={16} />
          </Link>
        </div>
      </main>
    </PublicFrame>
  );
}

export function JoinPage() {
  const { me, refresh } = useMe();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function join(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ gameId: string }>("/join", {
        method: "POST",
        body: JSON.stringify({
          code: code.trim().toUpperCase(),
          name: name.trim(),
        }),
      });
      await refresh();
      navigate(`/team/${result.gameId}`, { replace: true });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Не удалось войти. Проверьте код или обратитесь к ведущему.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <PublicFrame compact>
      <main className="container auth-page">
        <div className="card auth-card join-card">
          <div className="feature-icon lime">
            <Users size={28} />
          </div>
          <p className="eyebrow">Каждый ответ важен</p>
          <h1>Ваша команда ждёт</h1>
          <p className="muted">
            Введите код от ведущего и имя, которое увидят ваши товарищи.
          </p>
          {me?.participant && (
            <div className="notice">
              <p>
                Вы уже присоединились как <strong>{me.participant.name}</strong>
                .
              </p>
              <Link className="text-link" to={`/team/${me.participant.gameId}`}>
                Вернуться в команду <ArrowRight size={16} />
              </Link>
            </div>
          )}
          <form className="stack" onSubmit={join}>
            <ErrorMessage message={error} />
            <label className="field">
              Код команды
              <input
                className="join-code-input"
                required
                minLength={4}
                maxLength={24}
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="КОД КОМАНДЫ"
              />
              <small>У каждой команды своё приглашение.</small>
            </label>
            <label className="field">
              Ваше имя
              <input
                required
                minLength={1}
                maxLength={40}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="nickname"
                placeholder="Как к вам обращаться?"
              />
            </label>
            <button className="button primary" disabled={busy}>
              {busy ? "Присоединяемся…" : "Войти в команду"}{" "}
              {!busy && <ArrowRight size={18} />}
            </button>
          </form>
          <p className="form-hint">
            Предлагайте ответы всей командой. Капитана назначит ведущий — он
            отправит общий вариант.
          </p>
          <Link className="text-link" to="/help">
            Сначала посмотреть правила
          </Link>
        </div>
      </main>
    </PublicFrame>
  );
}

export function HelpPage() {
  return (
    <PublicFrame>
      <main className="container help-page">
        <div className="page-header">
          <p className="eyebrow">Правила и помощь</p>
          <h1>
            Сотня мнений.
            <br />
            Один общий ответ.
          </h1>
          <p className="muted">
            Угадайте, как люди отвечали на вопросы, и соберите больше очков, чем
            соперник.
          </p>
        </div>
        <div className="help-grid">
          <section className="card">
            <div className="feature-icon">
              <Gamepad2 size={26} />
            </div>
            <h2>Как проходит раунд</h2>
            <ol className="rules-list">
              <li>Ведущий показывает вопрос и объявляет команду хода.</li>
              <li>
                Игроки предлагают варианты, капитан отправляет один общий ответ.
                Можно отвечать и устно.
              </li>
              <li>
                Если ответ есть на табло, ведущий открывает его. Очки
                добавляются в банк раунда с учётом множителя.
              </li>
              <li>
                Три ошибки передают сопернику шанс на перехват. Ведущий
                оценивает его ответ.
              </li>
              <li>
                Банк получает победившая команда. Затем начинается следующий
                раунд.
              </li>
            </ol>
            <p className="form-hint">
              Точное решение о совпадении ответа принимает ведущий. Повтор уже
              открытого ответа новых очков не даёт.
            </p>
          </section>
          <section className="card">
            <h2>Если вы игрок</h2>
            <p>
              Откройте приглашение команды или введите её код. Укажите имя —
              регистрация и установка приложения не нужны.
            </p>
            <p>
              Во время хода своей команды пишите предложения. Тексты доступны
              только вашей команде и ведущему. Предложения не являются
              официальными ответами.
            </p>
            <h3>Если вы капитан</h3>
            <p>
              Выберите предложение или напишите итоговый вариант. Отправьте его
              один раз и дождитесь решения ведущего. Роль назначает ведущий.
            </p>
            <Link className="button primary" to="/join">
              Войти в команду <ArrowRight size={17} />
            </Link>
          </section>
          <section className="card">
            <div className="feature-icon lime">
              <Monitor size={25} />
            </div>
            <h2>Если вы гость</h2>
            <p>
              Откройте общее табло с главной страницы или смотрите экран в зале.
              На нём видны вопрос, открытые ответы и счёт команд.
            </p>
            <p>
              Во время ожидания и паузы табло остаётся открытым. После финала на
              нём появятся результаты.
            </p>
            <Link className="text-link" to="/">
              К общему экрану <ArrowRight size={16} />
            </Link>
          </section>
          <section className="card">
            <div className="feature-icon pink">
              <Wifi size={25} />
            </div>
            <h2>Если пропала связь</h2>
            <p>
              Не закрывайте страницу сразу. Она попытается подключиться снова и
              получить актуальное состояние. Несохранённый текст на телефоне
              останется в этой вкладке.
            </p>
            <p>
              При ошибке отправки проверьте состояние ответа: не повторяйте его
              автоматически. Если соединение не восстановилось, сообщите
              ведущему — можно продолжить устно.
            </p>
            <h3>Доступ организатора</h3>
            <p>
              Потерянный пароль восстанавливает владелец сервера по инструкции
              оператора. Не передавайте пароли и ключи другим участникам.
            </p>
          </section>
        </div>
        <aside className="notice help-note">
          <ShieldCheck size={24} />
          <div>
            <strong>Откуда берутся ответы?</strong>
            <p>
              Вопросы и результаты опросов готовит организатор. Демонстрационные
              вопросы всегда отмечены на табло и не выдаются за настоящий опрос.
            </p>
          </div>
        </aside>
      </main>
    </PublicFrame>
  );
}

export function NotFoundPage() {
  return (
    <PublicFrame compact>
      <main className="container auth-page">
        <div className="card auth-card empty-state">
          <span className="not-found-number">404</span>
          <h1>Кажется, это не тот ответ</h1>
          <p className="muted">
            Такой страницы нет. Вернитесь на главную или проверьте ссылку от
            ведущего.
          </p>
          <Link className="button primary" to="/">
            На главную <ArrowRight size={18} />
          </Link>
        </div>
      </main>
    </PublicFrame>
  );
}
