import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
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
  Check,
  Clipboard,
  Crown,
  Download,
  ExternalLink,
  FileQuestion,
  Flag,
  Gamepad2,
  ImagePlus,
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
import { api, useMe, useSite } from "../lib";
import { ErrorMessage, Loading } from "../components/Common";
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
    ["/admin/account", "Мой аккаунт", <ShieldCheck size={19} />],
  ] as const;
  return (
    <div className="admin-shell">
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
            <small>пространство организатора</small>
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
      <main className="admin-content">
        <Outlet />
      </main>
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
        <Link className="button button-primary" to={`/host/${game.id}`}>
          {game.phase === "lobby"
            ? "Открыть пульт"
            : game.phase === "finished"
              ? "Посмотреть игру"
              : "Продолжить"}
          <ArrowRight size={16} />
        </Link>
        <Link
          className="button button-ghost"
          to={`/admin/games/${game.id}`}
          aria-label={`Настройки ${game.title}`}
        >
          <Settings size={18} />
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
  const {
    value: questions,
    loading,
    error,
  } = useResource<Question[]>("/questions");
  const [title, setTitle] = useState("День социолога");
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
              placeholder="Например, День социолога · финал"
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
                            {question.answers.length} ответов
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
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [refresh]);
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
        description="Приглашайте команды, назначайте капитанов и подготовьте общий экран."
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
            <Link className="button button-primary" to={`/host/${game.id}`}>
              <Gamepad2 size={18} />
              Пульт ведущего
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
              Вопросы и оформление зафиксированы при создании. Для другого
              набора создайте новую игру.
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
                  {question.answers.length} ответов
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
  const [pendingImport, setPendingImport] = useState<{
    data: unknown;
    count: number;
    updating: number;
    filename: string;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
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
  const prepareImport = async (file: File) => {
    setBusy(true);
    setActionError("");
    setNotice("");
    setPendingImport(null);
    try {
      if (file.size > 3 * 1024 * 1024)
        throw new Error("Файл слишком большой. Максимум для импорта — 3 МБ.");
      const data = JSON.parse(await file.text());
      if (
        data?.format !== "ctokodnomy-questions-v1" ||
        !Array.isArray(data.questions) ||
        !data.questions.length ||
        data.questions.length > 500
      )
        throw new Error(
          "Нужен файл ctokodnomy-questions-v1 с 1–500 вопросами. Используйте файл экспорта библиотеки.",
        );
      const existing = new Set(
        (questions || []).map((question) => question.id),
      );
      const updating = data.questions.filter(
        (question: { id?: string } | null) =>
          question && existing.has(question.id || ""),
      ).length;
      setPendingImport({
        data,
        count: data.questions.length,
        updating,
        filename: file.name,
      });
      setDemoConfirm(false);
    } catch (err) {
      setActionError(
        err instanceof SyntaxError
          ? "Файл не содержит корректный JSON. Используйте файл экспорта библиотеки."
          : messageOf(err),
      );
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const importQuestions = async () => {
    if (!pendingImport) return;
    setBusy(true);
    setActionError("");
    try {
      const result = await api<{ count: number }>(
        "/questions/import",
        json("POST", pendingImport.data),
      );
      await refresh();
      setPendingImport(null);
      setNotice(`Импортировано вопросов: ${result.count}.`);
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
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={17} />
            Импорт JSON
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy || !questions?.length}
            onClick={() => void exportQuestions()}
          >
            <Download size={17} />
            Экспорт
          </button>
          <input
            ref={fileInput}
            hidden
            type="file"
            accept=".json,application/json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void prepareImport(file);
            }}
          />
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
      {pendingImport && (
        <div className="notice demo-confirm">
          <Upload size={24} />
          <div>
            <strong>
              Импортировать {pendingImport.count} вопросов из «
              {pendingImport.filename}»?
            </strong>
            <p>
              {pendingImport.updating
                ? `Существующих вопросов с совпадающими идентификаторами: ${pendingImport.updating}. Их содержимое будет заменено данными из файла.`
                : "Новые вопросы будут добавлены в библиотеку."}{" "}
              Снимки уже созданных партий сохранятся.
            </p>
            <div className="actions">
              <button
                type="button"
                disabled={busy}
                className="button button-secondary"
                onClick={() => void importQuestions()}
              >
                {busy ? "Импортируем…" : "Импортировать вопросы"}
              </button>
              <button
                type="button"
                disabled={busy}
                className="button button-ghost"
                onClick={() => setPendingImport(null)}
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
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
                  {question.answers.length} ответов ·{" "}
                  {question.answers.reduce(
                    (sum, answer) => sum + answer.points,
                    0,
                  )}{" "}
                  очков
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
        Импорт принимает файл формата <code>ctokodnomy-questions-v1</code>,
        который создаётся кнопкой «Экспорт». Вопросы проверяются и сохраняются
        целиком. Совпадающие идентификаторы обновляют вопросы библиотеки; уже
        созданные партии сохраняют свои снимки.
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
  useEffect(() => {
    let active = true;
    if (!questionId) {
      const next = freshQuestion();
      setQuestion(next);
      setAliases({});
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
      answers: current.answers.map((answer) =>
        answer.id === id ? { ...answer, ...patch } : answer,
      ),
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
              placeholder="Например, День социолога · основной тур"
            />
            <small className="muted">
              Набор помогает находить и группировать вопросы в библиотеке.
            </small>
          </label>
        </section>
        <section className="card form-section">
          <div className="section-heading">
            <div>
              <h2>Ответы на табло</h2>
              <p className="muted">
                Порядок в списке определяет позиции на табло. Обычно популярные
                ответы располагают выше.
              </p>
            </div>
            <span className="badge">
              Всего:{" "}
              {question.answers.reduce((sum, answer) => sum + answer.points, 0)}{" "}
              очков
            </span>
          </div>
          <div className="answer-editor-list">
            {question.answers.map((answer, index) => (
              <div key={answer.id} className="answer-editor-row">
                <span className="round-number">{index + 1}</span>
                <div className="answer-editor-fields">
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
            disabled={question.answers.length >= 12}
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
            открывает его автоматически.
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

function ImageField({
  label,
  value,
  busy,
  onUpload,
  onRemove,
}: {
  label: string;
  value: string;
  busy: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="image-field">
      <span className="field-label">{label}</span>
      <div className="image-upload-box">
        {value ? <img src={value} alt={label} /> : <ImagePlus size={30} />}
        <div>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <Upload size={15} />
            {value ? "Заменить" : "Загрузить"}
          </button>
          {value && (
            <button
              type="button"
              className="button button-ghost"
              disabled={busy}
              onClick={onRemove}
            >
              Убрать
            </button>
          )}
          <p className="muted">PNG, JPEG или WebP · до 2 МБ</p>
        </div>
        <input
          ref={input}
          type="file"
          hidden
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onUpload(file);
            event.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

function BrandPreview({ brand }: { brand: Brand }) {
  const style = {
    background: brand.background,
    color: brand.textColor,
    "--preview-primary": brand.primary,
    "--preview-accent": brand.accent,
  } as CSSProperties;
  const contrast = (first: string, second: string) => {
    const luminance = (hex: string) => {
      const values = hex
        .replace("#", "")
        .match(/.{2}/g)
        ?.map((value) => {
          const channel = parseInt(value, 16) / 255;
          return channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4;
        }) || [0, 0, 0];
      return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
    };
    const a = luminance(first);
    const b = luminance(second);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  const ratio = contrast(brand.background, brand.textColor);
  return (
    <section className="brand-preview-section">
      <div className="section-heading">
        <h2>Предпросмотр</h2>
        <span className="badge badge-demo">Демонстрация</span>
      </div>
      <p className="muted">
        Посмотрите, как мероприятие выглядит на общем экране и телефоне.
      </p>
      <div className="brand-preview-board" style={style}>
        <div className="preview-brand-row">
          {brand.logoUrl && (
            <img
              src={brand.logoUrl}
              alt="Логотип организатора в предпросмотре"
            />
          )}
          <span>{brand.organizer}</span>
        </div>
        {brand.gameLogoUrl ? (
          <img
            className="preview-game-logo"
            src={brand.gameLogoUrl}
            alt="Логотип игры в предпросмотре"
          />
        ) : (
          <strong className="preview-game-title">
            {brand.title || "100 к 1"}
          </strong>
        )}
        <p>{brand.description}</p>
        <div className="preview-answer">
          1<span>Открытый ответ</span>
          <strong>36</strong>
        </div>
        <div className="preview-hidden-answer">
          2 <span>••••••</span>
        </div>
        <div className="preview-score-row">
          <span>
            Команда 1 <strong>120</strong>
          </span>
          <span>
            Команда 2 <strong>85</strong>
          </span>
        </div>
        {brand.partnerLogoUrls.length > 0 && (
          <div className="preview-partners">
            {brand.partnerLogoUrls.map((url, index) => (
              <img
                key={`${url}-${index}`}
                src={url}
                alt={`Партнёр ${index + 1}`}
              />
            ))}
          </div>
        )}
      </div>
      <div className="brand-preview-phone" style={style}>
        <div className="preview-phone-speaker" />
        <small>{brand.organizer}</small>
        <h3>{brand.title || "100 к 1"}</h3>
        <span className="preview-role">Вы в команде</span>
        <h4>Ваш ход. Есть идея?</h4>
        <div className="preview-phone-input">Напишите свой вариант…</div>
        <span className="preview-phone-button">
          Предложить ответ <ArrowRight size={15} />
        </span>
        <small>Демонстрационный экран</small>
      </div>
      <p className={`contrast-note ${ratio < 4.5 ? "contrast-warning" : ""}`}>
        {ratio >= 4.5
          ? "✓ Текст и фон имеют достаточный контраст."
          : "Контраст текста и фона низкий. Выберите более светлый текст или более тёмный фон."}{" "}
        <span>Соотношение: {ratio.toFixed(1)}:1</span>
      </p>
    </section>
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
  const partnerInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (loaded) setBrand(loaded);
  }, [loaded]);
  const update = <K extends keyof Brand>(key: K, value: Brand[K]) => {
    setBrand((current) => (current ? { ...current, [key]: value } : current));
    setNotice("");
  };
  const upload = async (
    file: File,
    target: "logoUrl" | "gameLogoUrl" | "faviconUrl" | "partnerLogoUrls",
  ) => {
    setActionError("");
    setNotice("");
    if (file.size > 2 * 1024 * 1024) {
      setActionError("Изображение слишком большое. Выберите файл до 2 МБ.");
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setActionError("Допустимые форматы: PNG, JPEG и WebP.");
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const result = await api<{ url: string }>("/media", {
        method: "POST",
        body,
      });
      setBrand((current) =>
        current
          ? {
              ...current,
              [target]:
                target === "partnerLogoUrls"
                  ? [...current.partnerLogoUrls, result.url]
                  : result.url,
            }
          : current,
      );
    } catch (err) {
      setActionError(messageOf(err));
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
        eyebrow="Ваше мероприятие, ваш характер"
        title="Оформление"
        description="Единый стиль главной, командных комнат и общего табло."
      />
      <form onSubmit={save} className="branding-form">
        <div className="branding-editor">
          <section className="card form-section">
            <h2>Название и организатор</h2>
            <label className="field">
              Название игры
              <input
                required
                maxLength={120}
                value={brand.title}
                onChange={(event) => update("title", event.target.value)}
              />
            </label>
            <label className="field">
              Описание
              <textarea
                aria-label="Описание"
                rows={3}
                maxLength={500}
                value={brand.description}
                onChange={(event) => update("description", event.target.value)}
              />
            </label>
            <label className="field">
              Организатор
              <input
                maxLength={120}
                value={brand.organizer}
                onChange={(event) => update("organizer", event.target.value)}
                placeholder="Например, Социологический факультет"
              />
            </label>
          </section>
          <section className="card form-section">
            <h2>Цвета</h2>
            <div className="form-grid">
              {(
                [
                  ["primary", "Основной"],
                  ["accent", "Акцентный"],
                  ["background", "Фон"],
                  ["textColor", "Текст"],
                ] as const
              ).map(([key, label]) => (
                <label className="field color-field" key={key}>
                  {label}
                  <div>
                    <input
                      type="color"
                      value={brand[key]}
                      onChange={(event) => update(key, event.target.value)}
                    />
                    <span>{brand[key]}</span>
                  </div>
                </label>
              ))}
            </div>
          </section>
          <section className="card form-section">
            <h2>Логотипы и значок</h2>
            <ImageField
              label="Логотип организатора"
              value={brand.logoUrl}
              busy={uploading}
              onUpload={(file) => void upload(file, "logoUrl")}
              onRemove={() => update("logoUrl", "")}
            />
            <ImageField
              label="Логотип игры"
              value={brand.gameLogoUrl}
              busy={uploading}
              onUpload={(file) => void upload(file, "gameLogoUrl")}
              onRemove={() => update("gameLogoUrl", "")}
            />
            <ImageField
              label="Значок сайта"
              value={brand.faviconUrl}
              busy={uploading}
              onUpload={(file) => void upload(file, "faviconUrl")}
              onRemove={() => update("faviconUrl", "")}
            />
            <p className="muted">
              Для значка лучше выбрать квадратное изображение. Логотипы
              сохраняют исходные пропорции.
            </p>
          </section>
          <section className="card form-section">
            <div className="section-heading">
              <div>
                <h2>Партнёры мероприятия</h2>
                <p className="muted">
                  Логотипы появятся на экранах ожидания и итогов.
                </p>
              </div>
              <button
                type="button"
                className="button button-secondary"
                disabled={uploading || brand.partnerLogoUrls.length >= 8}
                onClick={() => partnerInput.current?.click()}
              >
                <Plus size={16} />
                Добавить
              </button>
            </div>
            <input
              ref={partnerInput}
              type="file"
              hidden
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file, "partnerLogoUrls");
                event.target.value = "";
              }}
            />
            {brand.partnerLogoUrls.length ? (
              <div className="partner-logo-list">
                {brand.partnerLogoUrls.map((url, index) => (
                  <div key={`${url}-${index}`}>
                    <img src={url} alt={`Логотип партнёра ${index + 1}`} />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Убрать логотип партнёра ${index + 1}`}
                      onClick={() =>
                        update(
                          "partnerLogoUrls",
                          brand.partnerLogoUrls.filter((_, i) => i !== index),
                        )
                      }
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">
                Необязательно. Оформление работает и без партнёрских логотипов.
              </p>
            )}
          </section>
        </div>
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
              Загрузка добавляет изображение. Нажмите «Сохранить», чтобы
              применить оформление.
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
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <small className="muted">
                Минимум 8 символов; лучше 12 и больше. Можно использовать
                длинную парольную фразу.
              </small>
            </label>
            <label className="field">
              Повторите новый пароль
              <input
                type="password"
                required
                minLength={8}
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
