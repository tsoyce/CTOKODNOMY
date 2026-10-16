import { useState, type FormEvent, type ReactNode } from "react";
import {
  Link,
  NavLink,
  Navigate,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
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
import { BrandMark, ErrorMessage, Loading } from "../components/Common";
import { BrandEditor, BrandPreview } from "../components/Branding";
import { SkipLink } from "../components/AppNavigation";
import { ThemeToggle } from "../components/ThemeToggle";

function PublicFrame({
  children,
  compact = false,
}: {
  children: ReactNode;
  compact?: boolean;
}) {
  const { me } = useMe();
  const { site } = useSite();
  const brand = site?.brand ?? defaultBrand;
  return (
    <div className={`public-page ${compact ? "public-page-compact" : ""}`}>
      <SkipLink target="page-main" />
      <header className="public-header container">
        <div className="brand-link">
          <BrandMark />
        </div>
        <nav aria-label="Основная навигация">
          <NavLink className="public-nav-link" to="/help">
            Как играть
          </NavLink>
          <NavLink className="public-nav-link" to="/join">
            В команду
          </NavLink>
          <Link
            className="button secondary small"
            to={me?.admin ? "/admin" : "/login"}
          >
            {me?.admin ? "Админка" : "Ведущему"} <ArrowRight size={16} />
          </Link>
        </nav>
        <ThemeToggle />
      </header>
      {children}
      <footer className="public-footer container">
        <div className="public-footer-brand">
          {brand.logoUrl && (
            <img src={brand.logoUrl} alt="Логотип организатора" />
          )}
          <span>
            {[brand.organizer, brand.footerText].filter(Boolean).join(" · ")}
          </span>
          {brand.partnerLogoUrls.length > 0 && (
            <div
              className="public-partner-logos"
              aria-label="Партнёры мероприятия"
            >
              {brand.partnerLogoUrls.map((url, index) => (
                <img
                  src={url}
                  alt={`Логотип партнёра ${index + 1}`}
                  key={`${url}-${index}`}
                />
              ))}
            </div>
          )}
        </div>
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

export function HomePage() {
  const { site } = useSite();
  const { me } = useMe();
  if (!site) return <Loading />;
  if (!site.initialized) return <Navigate to="/setup" replace />;
  const brand = site?.brand ?? defaultBrand;
  const games = site?.games ?? [];
  const activeGames = games.filter((game) => game.phase !== "finished");
  const gameToWatch = activeGames[0] ?? games[0];
  return (
    <PublicFrame>
      <main id="page-main" tabIndex={-1}>
        <section className="hero container">
          <div className="hero-content">
            {brand.organizer && (
              <p className="hero-eyebrow">
                <span className="status-dot" /> {brand.organizer}
              </p>
            )}
            {brand.logoUrl && (
              <img
                className="hero-organizer-logo"
                src={brand.logoUrl}
                alt="Логотип организатора"
              />
            )}
            {brand.heroTitle && (
              <h1 className="hero-title">{brand.heroTitle}</h1>
            )}
            {brand.description && (
              <p className="hero-description">{brand.description}</p>
            )}
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
            {brand.heroNote && (
              <p className="hero-note">
                <Users size={16} /> {brand.heroNote}
              </p>
            )}
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
              {brand.gameLogoUrl ? (
                <img
                  src={brand.gameLogoUrl}
                  alt=""
                  className="hero-game-logo"
                />
              ) : (
                <>
                  <span>100</span>
                  <small>к</small>
                  <span>1</span>
                </>
              )}
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
                  to={
                    game.resultsAvailable
                      ? `/results/${game.id}`
                      : `/board/${game.id}`
                  }
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
                    {game.resultsAvailable
                      ? "Итоги и ответы"
                      : game.phase === "finished"
                        ? "Финальный счёт"
                        : "Открыть табло"}{" "}
                    <ArrowRight size={20} />
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-state lobby-empty">
              <Monitor size={32} />
              <h3>Здесь появится общая доска</h3>
              <p>
                Когда ведущий подготовит игру, её табло будет доступно гостям.
                Игроки смогут войти по приглашению команды.
              </p>
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
  const [pendingUploads, setPendingUploads] = useState(0);
  const uploadBusy = pendingUploads > 0;
  const [error, setError] = useState("");
  if (!site) return <Loading />;
  if (site?.initialized)
    return (
      <PublicFrame compact>
        <main id="page-main" tabIndex={-1} className="container auth-page">
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
    if (uploadBusy) return;
    if (step === 0 && password !== passwordRepeat) {
      setError("Пароли не совпадают. Проверьте оба поля.");
      return;
    }
    setError("");
    setStep(step + 1);
  }
  async function finish(event: FormEvent) {
    event.preventDefault();
    if (uploadBusy) return;
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
  async function uploadImage(file: File) {
    setPendingUploads((pending) => pending + 1);
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await api<{ url: string }>("/setup/media", {
        method: "POST",
        headers: { "x-setup-token": token.trim() },
        body: form,
      });
      return result.url;
    } finally {
      setPendingUploads((pending) => pending - 1);
    }
  }
  return (
    <PublicFrame compact>
      <main id="page-main" tabIndex={-1} className="container setup-page" data-step={step}>
        <div className="page-header">
          <p className="eyebrow">Первый запуск · три простых шага</p>
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
                    minLength={1}
                    maxLength={128}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                    type="password"
                  />
                  <small>От 1 до 128 символов.</small>
                </label>
                <label className="field">
                  Повторите пароль
                  <input
                    required
                    minLength={1}
                    maxLength={128}
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
                <BrandEditor
                  brand={brand}
                  onChange={setBrand}
                  uploadImage={uploadImage}
                  disabled={busy}
                />
                <div className="button-row">
                  <button
                    className="button ghost"
                    type="button"
                    disabled={uploadBusy}
                    onClick={() => setStep(0)}
                  >
                    <ChevronLeft size={18} /> Назад
                  </button>
                  <button
                    className="button primary"
                    type="submit"
                    disabled={uploadBusy}
                  >
                    {uploadBusy ? "Загружаем логотип…" : "Предпросмотр"}{" "}
                    <ArrowRight size={18} />
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
                  {brand.organizer && (
                    <div>
                      <span>Мероприятие</span>
                      <strong>{brand.organizer}</strong>
                    </div>
                  )}
                </div>
                <p className="form-hint">
                  <ShieldCheck size={17} /> Одноразовый код будет погашен, а
                  повторная установка — закрыта.
                </p>
                <div className="button-row">
                  <button
                    className="button ghost"
                    type="button"
                    disabled={busy || uploadBusy}
                    onClick={() => setStep(1)}
                  >
                    <ChevronLeft size={18} /> Назад
                  </button>
                  <button
                    className="button primary"
                    disabled={busy || uploadBusy}
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
            <BrandPreview brand={brand} />
            <p className="form-hint">
              Так будут выглядеть главная страница и общий экран. Цвета, надписи
              и логотипы можно изменить в любой момент.
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
      <main id="page-main" tabIndex={-1} className="container auth-page">
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
      <main id="page-main" tabIndex={-1} className="container auth-page">
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
      <main id="page-main" tabIndex={-1} className="container help-page">
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
      <main id="page-main" tabIndex={-1} className="container auth-page">
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
