import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BarChart3,
  BookOpen,
  Check,
  ChevronRight,
  Clipboard,
  Crown,
  Download,
  ExternalLink,
  FileQuestion,
  Flag,
  Gamepad2,
  LayoutDashboard,
  LogOut,
  Palette,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import { ApiError, api, useMe, useSite } from "../lib";
import { ErrorMessage, Loading } from "../components/Common";
import { BrandEditor, BrandPreview } from "../components/Branding";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { SkipLink } from "../components/AppNavigation";
import { ThemeToggle } from "../components/ThemeToggle";
import {
  boardAnswers,
  gameBoardAnswers,
  GAME_ANSWER_LIMIT,
  MAX_QUESTION_ANSWERS,
  rankedAnswers,
} from "../../shared/questionAnswers";
import type {
  Answer,
  Brand,
  GameSummary,
  HostCommand,
  HostGame,
  Question,
} from "../../shared/types";
import "./Admin.css";

const phases: Record<string, string> = {
  lobby: "В ожидании",
  playing: "Идёт игра",
  steal: "Перехват",
  "round-result": "Итоги раунда",
  finished: "Завершена",
};
const messageOf = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Не удалось выполнить действие. Попробуйте ещё раз.";
const json = (method: string, data?: unknown): RequestInit => ({
  method,
  ...(data === undefined
    ? {}
    : {
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
});
const answerSummary = (answers: Answer[]) =>
  `${boardAnswers(answers).length} на табло · ${answers.length} в статистике`;

function PageHeading({
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

function EmptyState({
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

function useResource<T>(path: string) {
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

export function AdminLayout() {
  const { me } = useMe();
  const { site } = useSite();
  const location = useLocation();
  if (!me) return <Loading />;
  if (!me.admin)
    return (
      <Navigate
        to={`/login?returnTo=${encodeURIComponent(location.pathname)}`}
        replace
      />
    );
  const links = [
    ["/admin", "Обзор", <LayoutDashboard size={19} />],
    ["/admin/games", "Игры", <Gamepad2 size={19} />],
    ["/admin/questions", "Вопросы", <FileQuestion size={19} />],
    ["/admin/settings", "Оформление", <Palette size={19} />],
    ["/admin/account", "Аккаунт", <ShieldCheck size={19} />],
  ] as const;
  const section =
    links.find(
      ([path]) =>
        path !== "/admin" &&
        (location.pathname === path || location.pathname.startsWith(`${path}/`)),
    ) ?? links[0];
  const nestedPage = location.pathname === "/admin/games/new"
    ? "Новая игра"
    : location.pathname.startsWith("/admin/games/")
      ? "Настройки игры"
      : location.pathname === "/admin/questions/import"
        ? "Импорт вопросов"
        : location.pathname === "/admin/questions/new"
          ? "Новый вопрос"
          : location.pathname.startsWith("/admin/questions/")
            ? "Редактирование вопроса"
            : null;
  return (
    <div className="admin-shell">
      <SkipLink target="admin-main" />
      <aside className="admin-sidebar">
        <Link to="/" className="admin-brand">
          {site?.brand.gameLogoUrl || site?.brand.logoUrl ? (
            <img src={site.brand.gameLogoUrl || site.brand.logoUrl} alt="" />
          ) : (
            <span className="admin-brand-icon">
              100<span>к</span>1
            </span>
          )}
          <div>
            <strong>{site?.brand.title || "100 к 1"}</strong>
            <small>Управление игрой</small>
          </div>
        </Link>
        <div className="admin-nav-label">Управление</div>
        <nav aria-label="Разделы администрирования">
          {links.map(([path, text, icon]) => (
            <NavLink
              key={path}
              to={path}
              end={path === "/admin"}
              className={({ isActive }) =>
                `admin-nav-link${isActive ? " active" : ""}`
              }
            >
              {icon}
              <span>{text}</span>
            </NavLink>
          ))}
        </nav>
        <div className="admin-screen-guide">
          <Gamepad2 size={19} aria-hidden="true" />
          <div>
            <strong>Два экрана одной игры</strong>
            <p>
              Пульт — для ведущего.
              <br />
              Табло — для гостей в зале.
            </p>
          </div>
        </div>
        <div className="admin-sidebar-bottom">
          <span className="badge">
            <ShieldCheck size={14} /> Организатор
          </span>
          <p>{me.admin.username}</p>
          <Link to="/" className="admin-nav-link">
            <ArrowLeft size={18} />
            На главную
          </Link>
          <Link to="/help" className="muted">
            Правила и помощь
          </Link>
        </div>
      </aside>
      <div className="admin-workspace">
        <header className="admin-topbar">
          <nav className="admin-breadcrumbs" aria-label="Путь к странице">
            <ol>
              <li>
                <Link to="/admin">Организатор</Link>
              </li>
              <li>
                <ChevronRight size={15} aria-hidden="true" />
                {nestedPage ? (
                  <Link to={section[0]}>{section[1]}</Link>
                ) : (
                  <span aria-current="page">{section[1]}</span>
                )}
              </li>
              {nestedPage && (
                <li>
                  <ChevronRight size={15} aria-hidden="true" />
                  <span aria-current="page">{nestedPage}</span>
                </li>
              )}
            </ol>
          </nav>
          <div className="admin-topbar-actions">
            <Link className="admin-help-link" to="/help">
              <BookOpen size={18} aria-hidden="true" />
              <span>Правила и помощь</span>
            </Link>
            <ThemeToggle />
          </div>
        </header>
        <main id="admin-main" tabIndex={-1} className="admin-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function GameCard({ game }: { game: GameSummary }) {
  return (
    <article className="card game-card">
      <div className="game-card-top">
        <span
          className={`badge ${game.phase === "finished" ? "badge-neutral" : "badge-accent"}`}
        >
          {phases[game.phase]}
        </span>
        <time className="muted" dateTime={game.createdAt}>
          {new Intl.DateTimeFormat("ru-RU", {
            day: "numeric",
            month: "short",
          }).format(new Date(game.createdAt))}
        </time>
      </div>
      {game.phase === "finished" && (
        <p className="game-card-result-note muted">
          {game.resultsAvailable ? "Итоги опубликованы для гостей" : "Итоги видны только организатору"}
        </p>
      )}
      <h2>
        <Link to={`/admin/games/${game.id}`}>{game.title}</Link>
      </h2>
      <div className="game-team-summary">
        {game.teams.map((team) => (
          <div key={team.id}>
            <span className="team-dot" style={{ background: team.color }} />
            <span>{team.name}</span>
            <strong>{team.score}</strong>
          </div>
        ))}
      </div>
      <div className="game-card-actions">
        <Link
          className="button button-primary"
          to={game.phase === "finished" ? `/results/${game.id}` : `/host/${game.id}`}
        >
          {game.phase === "lobby"
            ? "Открыть пульт"
            : game.phase === "finished"
              ? "Итоги и ответы"
              : "Продолжить"}
          <ArrowRight size={16} />
        </Link>
        <Link
          className="button button-ghost"
          to={`/admin/games/${game.id}`}
          aria-label={`Настройки ${game.title}`}
        >
          <Settings size={18} /> Настройки
        </Link>
      </div>
    </article>
  );
}

export function DashboardPage() {
  const { site, refresh } = useSite();
  const { value: questions, error } = useResource<Question[]>("/questions");
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const games = site?.games || [];
  const active = games.filter((game) => game.phase !== "finished");
  return (
    <>
      <PageHeading
        eyebrow="Всё готово к хорошей игре"
        title="Добро пожаловать, организатор"
        description="Подготовьте вопросы, соберите команды и подарите гостям вечер открытий."
        actions={
          <Link className="button button-primary" to="/admin/games/new">
            <Plus size={18} />
            Создать игру
          </Link>
        }
      />
      <div className="stat-grid">
        <div className="card stat-card">
          <Gamepad2 />
          <strong>{games.length}</strong>
          <span>сохранённых игр</span>
        </div>
        <div className="card stat-card">
          <Flag />
          <strong>{active.length}</strong>
          <span>ожидают или идут сейчас</span>
        </div>
        <div className="card stat-card">
          <FileQuestion />
          <strong>{questions ? questions.length : "—"}</strong>
          <span>вопросов в библиотеке</span>
        </div>
      </div>
      {error && <ErrorMessage message={error} />}
      <div className="section-heading">
        <div>
          <h2>Ваши игры</h2>
          <p className="muted">
            {active.length
              ? "Можно продолжить с того места, где остановились."
              : "Новая история начинается с одного вопроса."}
          </p>
        </div>
        <Link className="text-link" to="/admin/games">
          Все игры <ArrowRight size={16} />
        </Link>
      </div>
      {games.length ? (
        <div className="cards-grid">
          {[...active, ...games.filter((game) => game.phase === "finished")]
            .slice(0, 4)
            .map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
        </div>
      ) : (
        <EmptyState
          icon={<Gamepad2 size={32} />}
          title="Первая игра — впереди"
          action={
            <Link className="button button-primary" to="/admin/games/new">
              <Plus size={18} />
              Подготовить первую игру
            </Link>
          }
        >
          Добавьте вопросы, выберите команды и откройте пульт ведущего. Игроки
          присоединятся по своим приглашениям.
        </EmptyState>
      )}
      <div className="onboarding-grid">
        <Link className="card quick-link" to="/admin/questions">
          <FileQuestion size={24} />
          <div>
            <h3>Соберите вопросы</h3>
            <p className="muted">Ответы, очки и источники опроса</p>
          </div>
          <ArrowRight size={18} />
        </Link>
        <Link className="card quick-link" to="/admin/settings">
          <Palette size={24} />
          <div>
            <h3>Добавьте ваш характер</h3>
            <p className="muted">Название, цвета и логотипы мероприятия</p>
          </div>
          <ArrowRight size={18} />
        </Link>
      </div>
    </>
  );
}

export function GamesPage() {
  const { site, refresh } = useSite();
  const [filter, setFilter] = useState<"all" | "active" | "finished">("all");
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const games = (site?.games || []).filter(
    (game) =>
      filter === "all" ||
      (filter === "finished"
        ? game.phase === "finished"
        : game.phase !== "finished"),
  );
  return (
    <>
      <PageHeading
        eyebrow="Игровой вечер"
        title="Игры"
        description="У каждой партии — свои вопросы, команды и история результатов."
        actions={
          <Link className="button button-primary" to="/admin/games/new">
            <Plus size={18} />
            Создать игру
          </Link>
        }
      />
      <div className="filter-tabs" aria-label="Фильтр игр">
        {(
          [
            ["all", "Все игры"],
            ["active", "Активные"],
            ["finished", "Завершённые"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            className={filter === value ? "active" : ""}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {games.length ? (
        <div className="cards-grid">
          {games.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Gamepad2 size={32} />}
          title={
            filter === "all"
              ? "Здесь появятся ваши игры"
              : "В этой категории пока пусто"
          }
          action={
            <Link className="button button-primary" to="/admin/games/new">
              Создать игру <ArrowRight size={16} />
            </Link>
          }
        >
          Подготовьте первую партию. Её вопросы и оформление сохранятся
          отдельно, а результаты останутся после перезапуска.
        </EmptyState>
      )}
    </>
  );
}

export function NewGamePage() {
  const navigate = useNavigate();
  const { site } = useSite();
  const {
    value: questions,
    loading,
    error,
  } = useResource<Question[]>("/questions");
  const [title, setTitle] = useState(site?.brand.title || "100 к 1");
  const [teams, setTeams] = useState([
    { name: "Команда 1", color: "#7559ff" },
    { name: "Команда 2", color: "#edff7a" },
  ]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [multipliers, setMultipliers] = useState<number[]>([]);
  const [stealAddsPoints, setStealAddsPoints] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const toggle = (id: string) => {
    if (!selected.includes(id) && selected.length >= 20) {
      setFormError("В одной игре может быть до 20 раундов.");
      return;
    }
    setFormError("");
    setSelected((ids) =>
      ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id],
    );
  };
  const move = (index: number, delta: number) =>
    setSelected((ids) => {
      const next = [...ids];
      const target = index + delta;
      if (target < 0 || target >= next.length) return ids;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setFormError("");
    if (!selected.length) {
      setFormError("Выберите хотя бы один вопрос для игры.");
      return;
    }
    if (
      teams[0].name.trim().toLowerCase() === teams[1].name.trim().toLowerCase()
    ) {
      setFormError(
        "Дайте командам разные названия, чтобы ведущий и гости не путались.",
      );
      return;
    }
    setBusy(true);
    try {
      const game = await api<HostGame>(
        "/games",
        json("POST", {
          title: title.trim(),
          questionIds: selected,
          teams: teams.map((team) => ({ ...team, name: team.name.trim() })),
          rules: {
            multipliers: selected.map((_, index) => multipliers[index] || 1),
            stealAddsPoints,
          },
        }),
      );
      navigate(`/admin/games/${game.id}`);
    } catch (err) {
      setFormError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  if (loading) return <Loading />;
  if (error) return <ErrorMessage message={error} />;
  return (
    <>
      <Link className="back-link" to="/admin/games">
        <ArrowLeft size={16} />К списку игр
      </Link>
      <PageHeading
        eyebrow="Новая партия"
        title="Соберём вашу игру"
        description="Назовите команды, задайте порядок вопросов — и можно приглашать игроков."
      />
      <form onSubmit={save} className="game-create-form">
        <section className="card form-section">
          <div className="section-heading">
            <h2>
              <span className="step-number">01</span> Игра и команды
            </h2>
          </div>
          <label className="field">
            Название игры
            <input
              required
              maxLength={120}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Например, Наш праздник · финал"
            />
          </label>
          <div className="form-grid">
            {teams.map((team, index) => (
              <div className="team-editor" key={index}>
                <div className="section-heading">
                  <h3>Команда {index + 1}</h3>
                  <span
                    className="team-dot"
                    style={{ background: team.color }}
                  />
                </div>
                <label className="field">
                  Название
                  <input
                    required
                    maxLength={60}
                    value={team.name}
                    onChange={(event) =>
                      setTeams((current) =>
                        current.map((item, i) =>
                          i === index
                            ? { ...item, name: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
                <label className="field color-field">
                  Цвет
                  <input
                    type="color"
                    value={team.color}
                    onChange={(event) =>
                      setTeams((current) =>
                        current.map((item, i) =>
                          i === index
                            ? { ...item, color: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                  <span>{team.color}</span>
                </label>
              </div>
            ))}
          </div>
        </section>
        <section className="card form-section">
          <div className="section-heading">
            <h2>
              <span className="step-number">02</span> Вопросы и раунды
            </h2>
            <span className="badge">Выбрано: {selected.length}</span>
          </div>
          <p className="muted">
            Порядок справа определяет раунды. Изменения в библиотеке после
            создания партии не повлияют на эти вопросы.
          </p>
          {!questions?.length ? (
            <EmptyState
              title="Сначала нужен хотя бы один вопрос"
              action={
                <Link
                  className="button button-primary"
                  to="/admin/questions/new"
                >
                  <Plus size={18} />
                  Добавить вопрос
                </Link>
              }
            >
              Создайте вопросы с ответами и очками в библиотеке, затем вернитесь
              к подготовке игры.
            </EmptyState>
          ) : (
            <div className="question-picker-grid">
              <div>
                <label className="search-field">
                  <Search size={18} />
                  <input
                    aria-label="Поиск вопросов"
                    placeholder="Найти вопрос или набор"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <div className="question-picker">
                  {questions
                    .filter((question) =>
                      `${question.prompt} ${question.pack}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    )
                    .map((question) => (
                      <label
                        className={`question-option ${selected.includes(question.id) ? "selected" : ""}`}
                        key={question.id}
                      >
                        <input
                          type="checkbox"
                          checked={selected.includes(question.id)}
                          onChange={() => toggle(question.id)}
                        />
                        <div>
                          <strong>{question.prompt}</strong>
                          <small className="muted">
                            {answerSummary(question.answers)}
                            {question.pack ? ` · ${question.pack}` : ""}
                            {question.isDemo ? " · Демо" : ""}
                          </small>
                        </div>
                      </label>
                    ))}
                </div>
              </div>
              <div className="selected-questions">
                <h3>Порядок раундов</h3>
                {selected.length ? (
                  selected.map((id, index) => (
                    <div key={id} className="selected-question">
                      <span className="round-number">{index + 1}</span>
                      <div>
                        <strong>
                          {
                            questions.find((question) => question.id === id)
                              ?.prompt
                          }
                        </strong>
                        <label className="multiplier-field">
                          Очки
                          <select
                            value={multipliers[index] || 1}
                            onChange={(event) =>
                              setMultipliers((current) => {
                                const next = [...current];
                                next[index] = Number(event.target.value);
                                return next;
                              })
                            }
                          >
                            <option value={1}>×1</option>
                            <option value={2}>×2</option>
                            <option value={3}>×3</option>
                          </select>
                        </label>
                      </div>
                      <div className="reorder-actions">
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => move(index, -1)}
                          disabled={index === 0}
                          aria-label={`Поднять раунд ${index + 1}`}
                        >
                          <ArrowUp size={16} />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => move(index, 1)}
                          disabled={index === selected.length - 1}
                          aria-label={`Опустить раунд ${index + 1}`}
                        >
                          <ArrowDown size={16} />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => toggle(id)}
                          aria-label={`Убрать раунд ${index + 1}`}
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="muted selected-placeholder">
                    Отметьте вопросы слева. Здесь появится сценарий вечера.
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
        <section className="card form-section">
          <h2>
            <span className="step-number">03</span> Правило перехвата
          </h2>
          <label className="check-field">
            <input
              type="checkbox"
              checked={stealAddsPoints}
              onChange={(event) => setStealAddsPoints(event.target.checked)}
            />
            <span>
              Добавлять очки открытого ответа к банку при успешном перехвате
              <small className="muted">
                Если выключено, команда забирает только банк, накопленный
                соперниками.
              </small>
            </span>
          </label>
        </section>
        {formError && <ErrorMessage message={formError} />}
        <div className="form-footer">
          <p className="muted">
            После создания вопросы, правила и оформление партии сохранятся как
            снимок.
          </p>
          <button
            className="button button-primary"
            type="submit"
            disabled={busy || !questions?.length}
          >
            {busy ? "Создаём…" : "Создать игру"}
            <ArrowRight size={18} />
          </button>
        </div>
      </form>
    </>
  );
}

function InviteCard({
  game,
  team,
  busy,
  onToggle,
}: {
  game: HostGame;
  team: HostGame["teams"][number];
  busy: boolean;
  onToggle: () => void;
}) {
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const url = `${window.location.origin}/join?code=${encodeURIComponent(team.joinCode)}`;
  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(url, {
      width: 180,
      margin: 2,
      color: { dark: "#111222", light: "#ffffff" },
    }).then((result) => {
      if (active) setQr(result);
    });
    return () => {
      active = false;
    };
  }, [url]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setCopyError("");
    } catch {
      setCopyError(
        "Не удалось скопировать автоматически. Выделите ссылку ниже и скопируйте её.",
      );
    }
  };
  const players = game.players.filter((player) => player.teamId === team.id);
  return (
    <article className="card invite-card">
      <div className="section-heading">
        <h3>
          <span className="team-dot" style={{ background: team.color }} />
          {team.name}
        </h3>
        <span className={`badge ${team.joinOpen ? "badge-accent" : ""}`}>
          {team.joinOpen ? "Вход открыт" : "Вход закрыт"}
        </span>
      </div>
      <div className="invite-content">
        {qr && (
          <img
            className="invite-qr"
            src={qr}
            alt={`QR приглашения команды ${team.name}`}
          />
        )}
        <div>
          <p className="muted">Код команды</p>
          <strong className="join-code">{team.joinCode}</strong>
          <p className="muted">
            {players.length} участников ·{" "}
            {players.find((player) => player.role === "captain")?.name ||
              "капитан не назначен"}
          </p>
        </div>
      </div>
      <label className="field">
        Ссылка для игроков
        <input
          value={url}
          readOnly
          onFocus={(event) => event.target.select()}
        />
      </label>
      <div className="actions">
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void copy()}
        >
          {copied ? <Check size={16} /> : <Clipboard size={16} />}
          {copied ? "Скопировано" : "Копировать ссылку"}
        </button>
        <button
          type="button"
          disabled={busy || game.phase === "finished"}
          className="button button-ghost"
          onClick={onToggle}
        >
          {team.joinOpen ? "Закрыть вход" : "Открыть вход"}
        </button>
      </div>
      {copyError && (
        <p role="status" className="muted">
          {copyError}
        </p>
      )}
    </article>
  );
}

export function GameSettingsPage() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const { refresh: refreshSite } = useSite();
  const {
    value: game,
    setValue: setGame,
    loading,
    error,
    setError,
    refresh,
  } = useResource<HostGame>(`/games/${encodeURIComponent(gameId || "")}/host`);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState<{
    kind: "reset" | "delete";
    revision: number;
    requestId?: string;
  } | null>(null);
  const [dialogError, setDialogError] = useState("");
  const [resultsCopied, setResultsCopied] = useState(false);
  const pendingReset = useRef<{ requestId: string; revision: number } | null>(null);
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!document.hidden && !busy) void refresh();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [refresh, busy]);
  const openConfirmation = (kind: "reset" | "delete") => {
    if (!game || busy) return;
    setDialogError("");
    setConfirmation(
      kind === "reset"
        ? { kind, ...(pendingReset.current ?? { requestId: crypto.randomUUID(), revision: game.revision }) }
        : { kind, revision: game.revision },
    );
  };
  const performLifecycleAction = async () => {
    if (!game || !confirmation || busy) return;
    const action = confirmation;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    setBusy(true);
    setDialogError("");
    setNotice("");
    try {
      if (action.kind === "reset") {
        const request = { requestId: action.requestId!, revision: action.revision };
        pendingReset.current = request;
        const next = await api<HostGame>(
          `/games/${game.id}/reset`,
          { ...json("POST", request), signal: controller.signal },
        );
        pendingReset.current = null;
        setGame(next);
        setConfirmation(null);
        setNotice("Игра готова к новому старту. Передайте командам новые приглашения ниже.");
      } else {
        await api<{ ok: true }>(
          `/games/${game.id}`,
          { ...json("DELETE", { revision: action.revision }), signal: controller.signal },
        );
        await refreshSite().catch(() => {});
        navigate("/admin/games", { replace: true });
        return;
      }
      setError("");
      await refreshSite().catch(() => {});
    } catch (err) {
      if (action.kind === "delete" && err instanceof ApiError && err.status === 404) {
        await refreshSite().catch(() => {});
        navigate("/admin/games", { replace: true });
        return;
      }
      if (err instanceof ApiError && err.status === 409) {
        if (action.kind === "reset") pendingReset.current = null;
        setConfirmation(null);
        await refresh();
        setError("Игра изменилась в другом окне. Проверьте её состояние и повторите действие.");
      } else {
        if (action.kind === "reset") {
          await refresh();
          setDialogError(
            err instanceof ApiError
              ? messageOf(err)
              : "Ответ сервера не получен. Повторите действие: тот же запрос не сбросит игру второй раз.",
          );
        } else {
          setDialogError(messageOf(err));
        }
      }
    } finally {
      window.clearTimeout(timeout);
      setBusy(false);
    }
  };
  const toggleResultsPublication = async () => {
    if (!game || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const next = await api<HostGame>(
        `/games/${game.id}/results/publication`,
        json("POST", { published: !game.resultsPublished, revision: game.revision }),
      );
      setGame(next);
      setError("");
      setNotice(next.resultsPublished
        ? "Итоги опубликованы. Поделитесь ссылкой с гостями."
        : "Итоги скрыты. Страница доступна только организатору.");
      await refreshSite().catch(() => {});
    } catch (err) {
      await refresh();
      setError(err instanceof ApiError && err.status === 409
        ? "Игра изменилась в другом окне. Состояние обновлено — проверьте публикацию и повторите действие."
        : messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  const copyResults = async () => {
    if (!game) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/results/${game.id}`);
      setResultsCopied(true);
      setError("");
    } catch {
      setError("Не удалось скопировать автоматически. Выделите ссылку на итоги ниже и скопируйте её.");
    }
  };
  const command = async (hostCommand: HostCommand) => {
    if (!game) return;
    setBusy(true);
    setNotice("");
    try {
      setGame(
        await api<HostGame>(
          `/games/${game.id}/commands`,
          json("POST", {
            requestId: crypto.randomUUID(),
            revision: game.revision,
            command: hostCommand,
          }),
        ),
      );
      setError("");
    } catch (err) {
      await refresh();
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  const captain = async (participantId: string) => {
    if (!game) return;
    setBusy(true);
    setNotice("");
    try {
      setGame(
        await api<HostGame>(
          `/games/${game.id}/captain`,
          json("POST", { participantId }),
        ),
      );
      setError("");
      setNotice(
        "Капитан назначен. На его телефоне появится отправка итогового ответа.",
      );
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  if (loading) return <Loading />;
  if (!game)
    return (
      <>
        <ErrorMessage message={error || "Игра не найдена."} />
        <Link to="/admin/games" className="button button-secondary">
          К списку игр
        </Link>
      </>
    );
  return (
    <>
      <Link className="back-link" to="/admin/games">
        <ArrowLeft size={16} />
        Все игры
      </Link>
      <PageHeading
        eyebrow={phases[game.phase]}
        title={game.title}
        description={game.phase === "finished"
          ? "Посмотрите результаты, поделитесь ответами с гостями или сыграйте ещё раз."
          : "Пригласите команды и откройте пульт. Гости смогут следить за игрой на табло."}
        actions={
          <>
            <Link
              className="button button-secondary"
              to={`/board/${game.id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={16} />
              Табло
            </Link>
            <Link
              className="button button-primary"
              to={game.phase === "finished" ? `/results/${game.id}` : `/host/${game.id}`}
            >
              {game.phase === "finished" ? <BarChart3 size={18} /> : <Gamepad2 size={18} />}
              {game.phase === "finished" ? "Итоги и ответы" : "Пульт ведущего"}
            </Link>
          </>
        }
      />
      {error && <ErrorMessage message={error} />}
      {notice && (
        <p className="success-message" role="status">
          <Check size={16} />
          {notice}
        </p>
      )}
      {game.phase === "finished" && (
        <section className="card form-section results-publication">
          <div className="section-heading">
            <div>
              <h2>Итоги для гостей</h2>
              <p className="muted">
                Ответы на вопросы, их популярность и финальный счёт — на одной странице.
              </p>
            </div>
            <span className={`badge ${game.resultsPublished ? "badge-accent" : ""}`}>
              {game.resultsPublished ? "Опубликованы" : "Пока скрыты"}
            </span>
          </div>
          <p className="muted">
            {game.resultsPublished
              ? "Страницу можно открыть без входа. Ссылка подходит для участников и гостей."
              : "Сначала проверьте страницу итогов. После публикации её смогут открыть все, у кого есть ссылка."}
          </p>
          <div className="actions">
            <Link className="button button-secondary" to={`/results/${game.id}`}>
              <BarChart3 size={18} /> Посмотреть итоги
            </Link>
            <button
              type="button"
              disabled={busy}
              className={`button ${game.resultsPublished ? "button-ghost" : "button-primary"}`}
              onClick={() => void toggleResultsPublication()}
            >
              {game.resultsPublished ? "Скрыть итоги" : "Опубликовать итоги"}
            </button>
          </div>
          {game.resultsPublished && (
            <div className="published-results-link">
              <label className="field">
                Ссылка на итоги
                <input
                  value={`${window.location.origin}/results/${game.id}`}
                  readOnly
                  onFocus={(event) => event.target.select()}
                />
              </label>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => void copyResults()}
              >
                {resultsCopied ? <Check size={17} /> : <Clipboard size={17} />}
                {resultsCopied ? "Скопировано" : "Копировать ссылку"}
              </button>
            </div>
          )}
        </section>
      )}
      <div className="notice">
        <ShieldCheck size={20} />
        <p>
          Приглашения предназначены для игроков соответствующей команды. Ссылка
          на публичное табло не открывает доступ в командную комнату.
        </p>
      </div>
      <div className="form-grid">
        {game.teams.map((team) => (
          <InviteCard
            key={team.id}
            team={team}
            game={game}
            busy={busy}
            onToggle={() =>
              void command({
                type: "join-toggle",
                teamId: team.id,
                open: !team.joinOpen,
              })
            }
          />
        ))}
      </div>
      <section className="card form-section">
        <div className="section-heading">
          <div>
            <h2>Участники и капитаны</h2>
            <p className="muted">
              Участники предлагают варианты. Только капитан отправляет итоговый
              ответ.
            </p>
          </div>
          <button
            type="button"
            className="button button-ghost"
            onClick={() => void refresh()}
          >
            <RefreshCw size={16} />
            Обновить
          </button>
        </div>
        <div className="form-grid">
          {game.teams.map((team) => (
            <div key={team.id}>
              <h3>
                <span className="team-dot" style={{ background: team.color }} />
                {team.name}
              </h3>
              {game.players.filter((player) => player.teamId === team.id)
                .length ? (
                <div className="participant-list">
                  {game.players
                    .filter((player) => player.teamId === team.id)
                    .map((player) => (
                      <div className="participant-row" key={player.id}>
                        <span className="avatar">
                          {player.name.slice(0, 1).toUpperCase()}
                        </span>
                        <div>
                          <strong>{player.name}</strong>
                          {player.role === "captain" && (
                            <span className="badge badge-accent">
                              <Crown size={13} />
                              Капитан
                            </span>
                          )}
                        </div>
                        {player.role !== "captain" && (
                          <button
                            type="button"
                            className="button button-ghost"
                            disabled={busy || game.phase === "finished"}
                            onClick={() => void captain(player.id)}
                          >
                            <Crown size={15} />
                            Назначить
                          </button>
                        )}
                      </div>
                    ))}
                </div>
              ) : (
                <p className="muted roster-empty">
                  <Users size={22} />
                  Пока никто не присоединился. Передайте команде код или QR
                  приглашения.
                </p>
              )}
            </div>
          ))}
        </div>
      </section>
      <section className="card form-section">
        <div className="section-heading">
          <div>
            <h2>Сценарий партии</h2>
            <p className="muted">
              Вопросы сохранены в этой партии. При сбросе оформление обновится
              из настроек сайта. Для другого набора создайте новую игру.
            </p>
          </div>
          <span className="badge">{game.questions.length} раундов</span>
        </div>
        <ol className="round-list">
          {game.questions.map((question, index) => (
            <li key={`${question.id}-${index}`}>
              <span className="round-number">{index + 1}</span>
              <div>
                <strong>{question.prompt}</strong>
                <small className="muted">
                  {gameBoardAnswers(game, question).length} на табло · {question.answers.length} в статистике
                  {question.isDemo ? " · Демонстрационный вопрос" : ""}
                  {question.pack ? ` · ${question.pack}` : ""}
                </small>
              </div>
              <span className="badge">
                ×
                {game.rules.multipliers[index] ??
                  game.rules.multipliers.at(-1) ??
                  1}
              </span>
            </li>
          ))}
        </ol>
        <p className="muted">
          Перехват:{" "}
          {game.rules.stealAddsPoints
            ? "очки найденного ответа добавляются к банку"
            : "команда получает накопленный банк без очков найденного ответа"}
          .
        </p>
      </section>
      <section className="card game-lifecycle">
        <div className="section-heading">
          <div>
            <h2>Управление партией</h2>
            <p className="muted">Вопросы в библиотеке сохранятся при любом действии.</p>
          </div>
        </div>
        <div className="game-lifecycle-row">
          <div>
            <h3>Сыграть ещё раз</h3>
            <p className="muted">
              Те же вопросы и команды, счёт с нуля и новые приглашения для игроков.
            </p>
          </div>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => openConfirmation("reset")}
          >
            <RefreshCw size={18} /> Начать заново
          </button>
        </div>
        <div className="game-lifecycle-row">
          <div>
            <h3>Удалить игру</h3>
            <p className="muted">Партия, её участники и результаты будут удалены.</p>
          </div>
          <button
            type="button"
            className="button button-danger"
            disabled={busy}
            onClick={() => openConfirmation("delete")}
          >
            <Trash2 size={18} /> Удалить игру
          </button>
        </div>
      </section>
      {confirmation && (
        <ConfirmDialog
          title={confirmation.kind === "reset" ? "Начать игру заново?" : "Удалить игру?"}
          description={confirmation.kind === "reset" ? (
            <>
              <p><strong>{game.title}</strong> вернётся в ожидание. Счёт, история, участники и опубликованные итоги будут сброшены.</p>
              <p>Вопросы и названия команд сохранятся. Оформление обновится из настроек сайта. Игрокам понадобятся новые приглашения.</p>
            </>
          ) : (
            <>
              <p><strong>{game.title}</strong>, её результаты и участники будут удалены без возможности восстановления.</p>
              <p>Вопросы в библиотеке останутся. Ссылки на эту игру перестанут работать.</p>
            </>
          )}
          confirmLabel={confirmation.kind === "reset" ? "Начать заново" : "Удалить игру"}
          danger={confirmation.kind === "delete"}
          busy={busy}
          error={dialogError}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => void performLifecycleAction()}
        />
      )}
    </>
  );
}

export function QuestionsPage() {
  const {
    value: questions,
    loading,
    error,
    refresh,
  } = useResource<Question[]>("/questions");
  const [search, setSearch] = useState("");
  const [pack, setPack] = useState("");
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [demoConfirm, setDemoConfirm] = useState(false);
  const packs = [
    ...new Set(
      (questions || []).map((question) => question.pack).filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, "ru"));
  const filtered = (questions || []).filter(
    (question) =>
      `${question.prompt} ${question.source} ${question.pack}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (!pack || question.pack === pack) &&
      (filter === "all" || question.isDemo === (filter === "demo")),
  );
  const remove = async (id: string) => {
    setBusy(true);
    setActionError("");
    try {
      await api(`/questions/${id}`, json("DELETE"));
      setDeleting(null);
      await refresh();
      setNotice(
        "Вопрос удалён из библиотеки. Снимки уже созданных игр сохранены.",
      );
    } catch (err) {
      setActionError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  const exportQuestions = async () => {
    setBusy(true);
    setActionError("");
    try {
      const data = await api("/questions/export");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "100k1-questions.json";
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice("Библиотека экспортирована в JSON.");
    } catch (err) {
      setActionError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  const addDemos = async () => {
    setBusy(true);
    setActionError("");
    try {
      const result = await api<{ count: number }>(
        "/questions/demo",
        json("POST", {}),
      );
      await refresh();
      setDemoConfirm(false);
      setNotice(
        `Добавлено ${result.count} демовопроса. Их ответы и очки вымышлены и помечены для репетиции.`,
      );
    } catch (err) {
      setActionError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  if (loading) return <Loading />;
  return (
    <>
      <PageHeading
        eyebrow="Основа хорошей игры"
        title="Библиотека вопросов"
        description="Храните ответы опроса, очки и источники. Выбирайте вопросы при создании партии."
        actions={
          <Link className="button button-primary" to="/admin/questions/new">
            <Plus size={18} />
            Добавить вопрос
          </Link>
        }
      />
      <div className="library-toolbar">
        <div className="actions">
          <Link
            to="/admin/questions/import"
            className="button button-secondary"
          >
            <Upload size={17} />
            Импорт JSON
          </Link>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy || !questions?.length}
            onClick={() => void exportQuestions()}
          >
            <Download size={17} />
            Экспорт
          </button>
          <button
            type="button"
            className="button button-ghost"
            disabled={busy}
            onClick={() => setDemoConfirm((value) => !value)}
          >
            Добавить демовопросы
          </button>
        </div>
        <span className="muted">{questions?.length || 0} вопросов</span>
      </div>
      {demoConfirm && (
        <div className="notice demo-confirm">
          <FileQuestion size={24} />
          <div>
            <strong>Добавить 3 вопроса для репетиции?</strong>
            <p>
              Это вымышленные ответы и очки, без проведённого опроса. Они будут
              явно помечены «Демо» в библиотеке, пульте и на табло.
            </p>
            <div className="actions">
              <button
                type="button"
                disabled={busy}
                className="button button-secondary"
                onClick={() => void addDemos()}
              >
                {busy ? "Добавляем…" : "Добавить для репетиции"}
              </button>
              <button
                type="button"
                className="button button-ghost"
                onClick={() => setDemoConfirm(false)}
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
      {error && <ErrorMessage message={error} />}
      {actionError && <ErrorMessage message={actionError} />}
      {notice && (
        <p className="success-message" role="status">
          <Check size={17} />
          {notice}
        </p>
      )}
      <div className="library-filters">
        <label className="search-field">
          <Search size={18} />
          <input
            aria-label="Поиск в библиотеке"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Вопрос, источник, набор…"
          />
        </label>
        <select
          aria-label="Набор вопросов"
          value={pack}
          onChange={(event) => setPack(event.target.value)}
        >
          <option value="">Все наборы</option>
          {packs.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select
          aria-label="Тип вопросов"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="all">Все вопросы</option>
          <option value="real">Для мероприятия</option>
          <option value="demo">Демонстрационные</option>
        </select>
      </div>
      {filtered.length ? (
        <div className="question-library">
          {filtered.map((question) => (
            <article key={question.id} className="card question-library-row">
              <div className="question-library-main">
                <div className="actions">
                  {question.pack && (
                    <span className="badge">{question.pack}</span>
                  )}
                  {question.isDemo && (
                    <span className="badge badge-demo">
                      Демо · вымышленные данные
                    </span>
                  )}
                </div>
                <h2>
                  <Link to={`/admin/questions/${question.id}`}>
                    {question.prompt}
                  </Link>
                </h2>
                <p className="muted">
                  {answerSummary(question.answers)} ·{" "}
                  {question.answers.reduce(
                    (sum, answer) => sum + answer.points,
                    0,
                  )}{" "}
                  очков всего
                  {question.respondentCount !== null
                    ? ` · ${question.respondentCount} опрошенных`
                    : ""}
                </p>
                {question.source && (
                  <p className="question-source">Источник: {question.source}</p>
                )}
              </div>
              <div className="question-library-actions">
                {deleting === question.id ? (
                  <div className="delete-confirm">
                    <strong>Удалить вопрос?</strong>
                    <div className="actions">
                      <button
                        type="button"
                        className="button button-danger"
                        disabled={busy}
                        onClick={() => void remove(question.id)}
                      >
                        Удалить
                      </button>
                      <button
                        type="button"
                        className="button button-ghost"
                        onClick={() => setDeleting(null)}
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <Link
                      className="button button-secondary"
                      to={`/admin/questions/${question.id}`}
                    >
                      Редактировать
                    </Link>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Удалить вопрос: ${question.prompt}`}
                      disabled={busy}
                      onClick={() => setDeleting(question.id)}
                    >
                      <Trash2 size={18} />
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title={
            questions?.length ? "Ничего не найдено" : "Пока ни одного вопроса"
          }
          action={
            questions?.length ? (
              <button
                className="button button-secondary"
                type="button"
                onClick={() => {
                  setSearch("");
                  setPack("");
                  setFilter("all");
                }}
              >
                Очистить фильтры
              </button>
            ) : (
              <Link className="button button-primary" to="/admin/questions/new">
                <Plus size={18} />
                Создать вопрос
              </Link>
            )
          }
        >
          {questions?.length
            ? "Попробуйте другое слово или выберите все наборы."
            : "Начните с результатов своего опроса или добавьте явно обозначенный демонабор для репетиции."}
        </EmptyState>
      )}
      <p className="muted library-note">
        В мастере импорта можно загрузить файл или вставить JSON, проверить
        ошибки и просмотреть ответы перед сохранением. Экспорт сохраняет всю
        библиотеку в формате <code>ctokodnomy-questions-v1</code>.
      </p>
    </>
  );
}

const freshQuestion = (): Question => ({
  id: "",
  prompt: "",
  answers: [35, 25, 15, 10, 8, 7].map((points) => ({
    id: crypto.randomUUID(),
    text: "",
    points,
    aliases: [],
  })),
  source: "",
  surveyDate: "",
  respondentCount: null,
  notes: "",
  isDemo: false,
  pack: "",
});

export function QuestionEditorPage() {
  const { questionId } = useParams();
  const navigate = useNavigate();
  const [question, setQuestion] = useState<Question>(freshQuestion);
  const [loading, setLoading] = useState(Boolean(questionId));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const savedTexts = useRef(new Map<string, string>());
  useEffect(() => {
    let active = true;
    if (!questionId) {
      const next = freshQuestion();
      setQuestion(next);
      setAliases({});
      savedTexts.current.clear();
      setLoading(false);
      return;
    }
    setLoading(true);
    void api<Question[]>("/questions")
      .then((questions) => {
        const next = questions.find((item) => item.id === questionId);
        if (!next)
          throw new Error(
            "Вопрос не найден. Возможно, его удалили из библиотеки.",
          );
        if (active) {
          setQuestion(next);
          savedTexts.current = new Map(
            next.answers.map((answer) => [answer.id, answer.text]),
          );
          setAliases(
            Object.fromEntries(
              next.answers.map((answer) => [
                answer.id,
                answer.aliases.join(", "),
              ]),
            ),
          );
          setError("");
        }
      })
      .catch((err) => {
        if (active) setError(messageOf(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [questionId]);
  const update = <K extends keyof Question>(key: K, value: Question[K]) =>
    setQuestion((current) => ({ ...current, [key]: value }));
  const updateAnswer = (id: string, patch: Partial<Answer>) =>
    setQuestion((current) => ({
      ...current,
      answers: current.answers.map((answer) => {
        if (answer.id !== id) return answer;
        const previousText = savedTexts.current.get(id);
        const archiveText =
          patch.text !== undefined &&
          patch.text !== answer.text &&
          !answer.originals?.length &&
          previousText?.trim();
        return {
          ...answer,
          ...(archiveText ? { originals: [previousText!] } : {}),
          ...patch,
        };
      }),
    }));
  const moveAnswer = (index: number, delta: number) =>
    setQuestion((current) => {
      const answers = [...current.answers];
      const target = index + delta;
      if (target < 0 || target >= answers.length) return current;
      [answers[index], answers[target]] = [answers[target], answers[index]];
      return { ...current, answers };
    });
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (question.answers.length < 1) {
      setError("Добавьте хотя бы один ответ.");
      return;
    }
    const normalized = {
      ...question,
      prompt: question.prompt.trim(),
      answers: question.answers.map((answer) => ({
        ...answer,
        text: answer.text.trim(),
        aliases: (aliases[answer.id] || "")
          .split(",")
          .map((alias) => alias.trim())
          .filter(Boolean),
      })),
    };
    if (
      new Set(
        normalized.answers.map((answer) => answer.text.toLocaleLowerCase("ru")),
      ).size !== normalized.answers.length
    ) {
      setError("Ответы должны отличаться друг от друга.");
      return;
    }
    setBusy(true);
    const { id: _id, ...newQuestion } = normalized;
    try {
      await api<Question>(
        questionId ? `/questions/${questionId}` : "/questions",
        json(
          questionId ? "PUT" : "POST",
          questionId ? normalized : newQuestion,
        ),
      );
      navigate("/admin/questions");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  if (loading) return <Loading />;
  const topAnswers = boardAnswers(question.answers);
  const boardPositions = new Map(
    topAnswers.map((answer, index) => [answer.id, index + 1]),
  );
  return (
    <>
      <Link className="back-link" to="/admin/questions">
        <ArrowLeft size={16} />
        Библиотека вопросов
      </Link>
      <PageHeading
        eyebrow={questionId ? "Редактирование" : "Новый вопрос"}
        title={questionId ? "Вопрос и ответы" : "О чём спросим людей?"}
        description="Добавьте формулировку, результаты опроса и заметки, которые увидит только ведущий."
      />
      <form className="question-editor" onSubmit={save}>
        <section className="card form-section">
          <label className="field">
            Вопрос
            <textarea
              aria-label="Вопрос"
              required
              rows={3}
              maxLength={500}
              value={question.prompt}
              onChange={(event) => update("prompt", event.target.value)}
              placeholder="Например, Что люди чаще всего делают в общественном транспорте?"
            />
          </label>
          <label className="field">
            Набор
            <input
              value={question.pack}
              maxLength={100}
              onChange={(event) => update("pack", event.target.value)}
              placeholder="Например, Наш праздник · основной тур"
            />
            <small className="muted">
              Набор помогает находить и группировать вопросы в библиотеке.
            </small>
          </label>
        </section>
        <section className="card form-section">
          <div className="section-heading">
            <div>
              <h2>Все ответы опроса</h2>
              <p className="muted">
                В игре на табло попадут до {GAME_ANSWER_LIMIT} самых популярных
                ответов. В статистике останутся все варианты, включая редкие.
                При равных очках порядок задают стрелки.
              </p>
            </div>
            <div className="answer-editor-summary">
              <span className="badge">{answerSummary(question.answers)}</span>
              <span className="muted">
                Сумма очков:{" "}
                {question.answers.reduce((sum, answer) => sum + answer.points, 0)}
              </span>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => update("answers", rankedAnswers(question.answers))}
              >
                <ArrowDown size={16} /> По популярности
              </button>
            </div>
          </div>
          <p className="muted answer-public-note">
            Поле «Ответ» увидят игроки и гости. Здесь можно смягчить шутку или
            уточнить название: исходные формулировки сохранятся отдельно и будут
            доступны только организатору.
          </p>
          <div className="answer-editor-list">
            {question.answers.map((answer, index) => (
              <div
                key={answer.id}
                className={`answer-editor-row${boardPositions.has(answer.id) ? "" : " answer-statistics-only"}`}
              >
                <span className="round-number">{index + 1}</span>
                <div className="answer-editor-fields">
                  <span
                    className={`badge answer-visibility${boardPositions.has(answer.id) ? " badge-accent" : ""}`}
                  >
                    {boardPositions.has(answer.id)
                      ? `ТОП ${boardPositions.get(answer.id)} · На табло`
                      : "Только статистика"}
                  </span>
                  <div className="answer-main-fields">
                    <label className="field">
                      Ответ
                      <input
                        required
                        maxLength={200}
                        value={answer.text}
                        onChange={(event) =>
                          updateAnswer(answer.id, { text: event.target.value })
                        }
                        placeholder="Текст ответа"
                      />
                    </label>
                    <label className="field points-field">
                      Очки
                      <input
                        type="number"
                        required
                        min={0}
                        max={1000}
                        step={1}
                        value={answer.points}
                        onChange={(event) =>
                          updateAnswer(answer.id, {
                            points: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                  <label className="field aliases-field">
                    Допустимые формулировки
                    <input
                      value={aliases[answer.id] || ""}
                      maxLength={1000}
                      onChange={(event) =>
                        setAliases((current) => ({
                          ...current,
                          [answer.id]: event.target.value,
                        }))
                      }
                      placeholder="Синонимы через запятую · подсказка ведущему"
                    />
                  </label>
                  {!!answer.originals?.length && (
                    <details className="answer-originals">
                      <summary>
                        Исходные формулировки · {answer.originals.length}
                      </summary>
                      <p>Только для организатора. В общий экран не передаются.</p>
                      <ul>
                        {answer.originals.map((original, originalIndex) => (
                          <li key={originalIndex}>{original}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
                <div className="reorder-actions">
                  <button
                    type="button"
                    className="icon-button"
                    disabled={index === 0}
                    aria-label={`Поднять ответ ${index + 1}`}
                    onClick={() => moveAnswer(index, -1)}
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={index === question.answers.length - 1}
                    aria-label={`Опустить ответ ${index + 1}`}
                    onClick={() => moveAnswer(index, 1)}
                  >
                    <ArrowDown size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={question.answers.length <= 1}
                    aria-label={`Удалить ответ ${index + 1}`}
                    onClick={() =>
                      update(
                        "answers",
                        question.answers.filter(
                          (item) => item.id !== answer.id,
                        ),
                      )
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="button button-secondary"
            disabled={question.answers.length >= MAX_QUESTION_ANSWERS}
            onClick={() =>
              update("answers", [
                ...question.answers,
                { id: crypto.randomUUID(), text: "", points: 1, aliases: [] },
              ])
            }
          >
            <Plus size={17} />
            Добавить ответ
          </button>
          <p className="muted">
            Формулировки помогают ведущему принять решение. Совпадение ответа не
            открывает его автоматически. Можно сохранить до{" "}
            {MAX_QUESTION_ANSWERS} вариантов на вопрос.
          </p>
        </section>
        <section className="card form-section">
          <h2>Источник и заметки</h2>
          <label className="check-field">
            <input
              type="checkbox"
              checked={question.isDemo}
              onChange={(event) => update("isDemo", event.target.checked)}
            />
            <span>
              Демонстрационный вопрос
              <small className="muted">
                Отметьте, если ответы или очки вымышлены. На табло появится
                обозначение «Демо».
              </small>
            </span>
          </label>
          <label className="field">
            Источник опроса
            <input
              value={question.source}
              maxLength={1000}
              onChange={(event) => update("source", event.target.value)}
              placeholder="Кто проводил опрос, ссылка или описание исследования"
            />
          </label>
          <div className="form-grid">
            <label className="field">
              Дата опроса
              <input
                type="date"
                value={question.surveyDate}
                onChange={(event) => update("surveyDate", event.target.value)}
              />
            </label>
            <label className="field">
              Количество респондентов
              <input
                type="number"
                min={1}
                max={1000000}
                value={question.respondentCount ?? ""}
                onChange={(event) =>
                  update(
                    "respondentCount",
                    event.target.value === ""
                      ? null
                      : Number(event.target.value),
                  )
                }
                placeholder="Если известно"
              />
            </label>
          </div>
          <label className="field">
            Заметки ведущему
            <textarea
              aria-label="Заметки ведущему"
              rows={3}
              maxLength={4000}
              value={question.notes}
              onChange={(event) => update("notes", event.target.value)}
              placeholder="Контекст, уточнения и спорные формулировки. Игроки и гости их не увидят."
            />
          </label>
        </section>
        {error && <ErrorMessage message={error} />}
        <div className="form-footer">
          <p className="muted">
            Изменения относятся к библиотеке. Снимки вопросов в созданных
            партиях сохранятся.
          </p>
          <div className="actions">
            <Link className="button button-ghost" to="/admin/questions">
              Отмена
            </Link>
            <button
              className="button button-primary"
              type="submit"
              disabled={busy || (Boolean(questionId) && !question.id)}
            >
              <Check size={18} />
              {busy ? "Сохраняем…" : "Сохранить вопрос"}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}

export function SettingsPage() {
  const { value: loaded, loading, error } = useResource<Brand>("/settings");
  const { refresh } = useSite();
  const [brand, setBrand] = useState<Brand | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (loaded) setBrand(loaded);
  }, [loaded]);
  const uploadImage = async (file: File): Promise<string> => {
    setActionError("");
    setNotice("");
    setUploading(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const result = await api<{ url: string }>("/media", {
        method: "POST",
        body,
      });
      return result.url;
    } finally {
      setUploading(false);
    }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!brand) return;
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      setBrand(await api<Brand>("/settings", json("PUT", brand)));
      await refresh();
      setNotice(
        "Оформление сохранено. Новые игры получат эти настройки, а текущие сохранят свой снимок.",
      );
    } catch (err) {
      setActionError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  if (loading) return <Loading />;
  if (!brand)
    return (
      <ErrorMessage message={error || "Не удалось загрузить оформление."} />
    );
  return (
    <>
      <PageHeading
        eyebrow="Любой повод собраться вместе"
        title="Оформление"
        description="Свои слова, логотипы и цвета. Один стиль для главной страницы, телефонов и общего экрана."
      />
      <form onSubmit={save} className="branding-form">
        <BrandEditor
          brand={brand}
          onChange={(next) => {
            setBrand(next);
            setNotice("");
          }}
          uploadImage={uploadImage}
          disabled={busy || uploading}
        />
        <div className="branding-preview">
          <BrandPreview brand={brand} />
        </div>
        <div className="branding-form-footer">
          {(error || actionError) && (
            <ErrorMessage message={actionError || error} />
          )}
          {notice && (
            <p className="success-message" role="status">
              <Check size={17} />
              {notice}
            </p>
          )}
          <div className="form-footer">
            <p className="muted">
              Нажмите «Сохранить оформление», чтобы применить изменения к сайту
              и новым играм.
            </p>
            <button
              type="submit"
              className="button button-primary"
              disabled={busy || uploading}
            >
              <Check size={18} />
              {busy
                ? "Сохраняем…"
                : uploading
                  ? "Загружаем изображение…"
                  : "Сохранить оформление"}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}

export function AccountPage() {
  const { me, refresh } = useMe();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (newPassword !== repeatPassword) {
      setError("Новые пароли не совпадают. Проверьте оба поля.");
      return;
    }
    setBusy(true);
    try {
      await api(
        "/account/password",
        json("POST", { currentPassword, newPassword }),
      );
      setCurrentPassword("");
      setNewPassword("");
      setRepeatPassword("");
      setNotice("Пароль обновлён. Используйте его при следующем входе.");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/logout", json("POST"));
      await refresh();
      navigate("/login");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="Доступ организатора"
        title="Мой аккаунт"
        description="Управляйте своим паролем и текущей сессией."
      />
      <div className="account-layout">
        <section className="card form-section">
          <div className="account-identity">
            <span className="avatar avatar-large">
              {me?.admin?.username.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <h2>{me?.admin?.username}</h2>
              <span className="badge">
                <ShieldCheck size={14} />
                Администратор
              </span>
            </div>
          </div>
          <form onSubmit={save}>
            <h3>Изменить пароль</h3>
            <label className="field">
              Текущий пароль
              <input
                type="password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label className="field">
              Новый пароль
              <input
                type="password"
                required
                minLength={1}
                maxLength={128}
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <small className="muted">От 1 до 128 символов.</small>
            </label>
            <label className="field">
              Повторите новый пароль
              <input
                type="password"
                required
                minLength={1}
                maxLength={128}
                autoComplete="new-password"
                value={repeatPassword}
                onChange={(event) => setRepeatPassword(event.target.value)}
              />
            </label>
            {error && <ErrorMessage message={error} />}
            {notice && (
              <p className="success-message" role="status">
                <Check size={16} />
                {notice}
              </p>
            )}
            <button
              type="submit"
              className="button button-primary"
              disabled={busy}
            >
              <ShieldCheck size={17} />
              {busy ? "Подождите…" : "Обновить пароль"}
            </button>
          </form>
        </section>
        <div>
          <section className="card form-section">
            <h2>Завершить сессию</h2>
            <p className="muted">
              Игры, вопросы и оформление сохранятся. Для возвращения в админку
              понадобится войти снова.
            </p>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => void logout()}
            >
              <LogOut size={17} />
              Выйти из аккаунта
            </button>
          </section>
          <div className="notice">
            <ShieldCheck size={20} />
            <div>
              <strong>Если доступ потерян</strong>
              <p>
                Владелец сервера может сбросить пароль через операторскую
                команду. Инструкция доступна в документации размещения.
              </p>
              <Link className="text-link" to="/help">
                Правила и помощь <ArrowRight size={15} />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
