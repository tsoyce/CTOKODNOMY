import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  Check,
  CheckCheck,
  Clipboard,
  Eye,
  HelpCircle,
  RefreshCw,
  Sparkles,
  Trophy,
} from "lucide-react";
import { defaultBrand, type PublicGameResults } from "../../shared/types";
import { gameAnalytics } from "../../shared/gameAnalytics";
import { ApiError, api, brandStyle } from "../lib";
import { Loading } from "../components/Common";
import { RoundStatistics } from "../components/Statistics";
import { isLightBrand } from "../theme";
import "./Results.css";

const number = new Intl.NumberFormat("ru-RU");

function useResults(id: string | undefined) {
  const [report, setReport] = useState<PublicGameResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    let stopped = false;
    let sequence = 0;
    let controller: AbortController | undefined;
    setReport(null);
    setLoading(true);
    setError("");
    setUnavailable(false);

    const update = async () => {
      if (!id) {
        setLoading(false);
        setUnavailable(true);
        return;
      }
      const current = ++sequence;
      controller?.abort();
      controller = new AbortController();
      try {
        const next = await api<PublicGameResults>(
          `/games/${encodeURIComponent(id)}/results`,
          { signal: controller.signal },
        );
        if (stopped || current !== sequence) return;
        setReport({ ...next, brand: { ...defaultBrand, ...next.brand } });
        setUnavailable(false);
        setError("");
      } catch (cause) {
        if (stopped || current !== sequence) return;
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        if (
          cause instanceof ApiError &&
          [401, 403, 404].includes(cause.status)
        ) {
          // Remove every answer when publication is withdrawn or a game is reset/deleted.
          setReport(null);
          setUnavailable(true);
          setError("");
        } else {
          setError(
            cause instanceof Error
              ? cause.message
              : "Не удалось обновить итоги. Попробуйте ещё раз.",
          );
        }
      } finally {
        if (!stopped && current === sequence) setLoading(false);
      }
    };
    refreshRef.current = () => void update();
    const visible = () => {
      if (document.visibilityState === "visible") void update();
    };
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void update();
    }, 15000);
    document.addEventListener("visibilitychange", visible);
    void update();
    return () => {
      stopped = true;
      sequence += 1;
      controller?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      refreshRef.current = () => {};
    };
  }, [id]);

  return { report, loading, error, unavailable, refresh };
}

function ResultsAnalytics({ report }: { report: PublicGameResults }) {
  const [selectedTeam, setSelectedTeam] = useState("all");
  useEffect(() => setSelectedTeam("all"), [report.id]);
  const analytics = gameAnalytics(report);
  const teamFilter = analytics.teams.some((team) => team.id === selectedTeam)
    ? selectedTeam
    : "all";
  const visibleTeams = analytics.teams.filter(
    (team) => teamFilter === "all" || team.id === teamFilter,
  );
  const maximum = Math.max(
    1,
    ...analytics.rounds.flatMap((round) =>
      analytics.teams.map((team) => round.cumulativeBanks[team.id] ?? 0),
    ),
  );

  return (
    <>
      <section
        className="results-team-comparison"
        aria-labelledby="results-team-comparison-heading"
      >
        <header className="results-analytics-heading">
          <p className="eyebrow">Вклад в результат</p>
          <h2 id="results-team-comparison-heading">Команды в цифрах</h2>
          <p>
            Сколько раундов выиграла каждая команда и сколько очков принесли
            банки. Финальный счёт учитывает также изменения ведущего.
          </p>
        </header>
        {!analytics.completeHistory && (
          <p className="results-history-note">
            История неполная: показаны только подтверждённые банки и победы.
            Полный итог по раундам и разницу с финальным счётом восстановить
            нельзя.
          </p>
        )}
        <div className="results-team-analytics-grid">
          {analytics.teams.map((team) => (
            <article
              className="results-team-analytics"
              data-team-id={team.id}
              key={team.id}
            >
              <h3>
                <span
                  className="results-team-color"
                  style={{ backgroundColor: team.color }}
                  aria-hidden="true"
                />
                {team.name}
              </h3>
              <dl>
                <div className="results-team-final-score">
                  <dt>Финальный счёт</dt>
                  <dd>{number.format(team.score)}</dd>
                </div>
                <div>
                  <dt>
                    {analytics.completeHistory
                      ? "Побед в раундах"
                      : "Известных побед"}
                  </dt>
                  <dd>{number.format(team.roundWins)}</dd>
                </div>
                <div>
                  <dt>
                    {analytics.completeHistory
                      ? "Очков из банка"
                      : "Известно очков из банка"}
                  </dt>
                  <dd>{number.format(team.bankPoints)}</dd>
                </div>
                {team.scoreAdjustment !== null && (
                  <div>
                    <dt>Разница со счётом</dt>
                    <dd>
                      {team.scoreAdjustment > 0 ? "+" : ""}
                      {number.format(team.scoreAdjustment)}
                    </dd>
                  </div>
                )}
              </dl>
            </article>
          ))}
        </div>
        {analytics.completeHistory && (
          <p className="results-analytics-explanation">
            Разница со счётом — финальный счёт минус банки выигранных раундов.
            Время и причины этих изменений здесь не показаны.
          </p>
        )}
      </section>

      <section
        className="results-dynamics"
        aria-labelledby="results-dynamics-heading"
      >
        <header className="results-dynamics-heading">
          <div className="results-analytics-heading">
            <p className="eyebrow">От раунда к раунду</p>
            <h2 id="results-dynamics-heading">Как менялись очки</h2>
            <p>
              Накопленные очки из банка после каждого сыгранного раунда.
              Изменения счёта ведущим в эту динамику не входят.
            </p>
          </div>
          {analytics.teams.length > 1 && (
            <label className="results-question-filter">
              <span>Показать команду</span>
              <select
                aria-label="Команда в динамике"
                value={teamFilter}
                onChange={(event) => setSelectedTeam(event.target.value)}
              >
                <option value="all">Все команды</option>
                {analytics.teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </header>
        {analytics.rounds.length > 0 ? (
          <div
            className="results-dynamics-scroll"
            role="region"
            aria-label="Таблица динамики очков, можно прокрутить по горизонтали"
            tabIndex={0}
          >
            <table className="results-dynamics-table">
              <caption>Накопленные очки из банка по раундам</caption>
              <thead>
                <tr>
                  <th scope="col">Раунд</th>
                  {visibleTeams.map((team) => (
                    <th scope="col" key={team.id}>
                      <span
                        className="results-team-color"
                        style={{ backgroundColor: team.color }}
                        aria-hidden="true"
                      />
                      {team.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {analytics.rounds.map((round, index) => (
                  <tr key={`${round.questionId}-${index}`}>
                    <th scope="row">
                      <strong>Раунд {round.questionIndex + 1}</strong>
                      <small>
                        {!round.completed
                          ? "Не завершён"
                          : round.awardKnown
                            ? "Завершён"
                            : "Нет полной записи"}
                      </small>
                    </th>
                    {visibleTeams.map((team) => {
                      const value = round.cumulativeBanks[team.id];
                      return (
                        <td key={team.id}>
                          {value === null ? (
                            <span className="results-dynamics-unknown">
                              Нет данных
                            </span>
                          ) : (
                            <div className="results-dynamics-value">
                              <strong>{number.format(value)}</strong>
                              <span
                                className="results-dynamics-track"
                                aria-hidden="true"
                              >
                                <span
                                  style={{
                                    width: `${(value / maximum) * 100}%`,
                                    backgroundColor: team.color,
                                  }}
                                />
                              </span>
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="results-no-dynamics">
            Игра завершилась до первого раунда. Динамика появится после
            сыгранных вопросов.
          </p>
        )}
        {!analytics.completeHistory && analytics.rounds.length > 0 && (
          <p className="results-analytics-explanation">
            «Нет данных» означает, что часть истории не сохранилась.
            Подтверждённые очки из следующих раундов включены в цифры команд
            выше, но накопленный итог восстановить нельзя.
          </p>
        )}
      </section>
    </>
  );
}

export default function ResultsPage() {
  const { gameId } = useParams();
  const { report, loading, error, unavailable, refresh } = useResults(gameId);
  const [question, setQuestion] = useState("all");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    setQuestion("all");
    setCopied(false);
    setCopyError("");
    return () => clearTimeout(copyTimer.current);
  }, [gameId]);

  if (loading) return <Loading />;
  if (!report) {
    return (
      <main className="results-unavailable container">
        <div className="results-empty-icon" aria-hidden="true">
          {unavailable ? <Eye size={32} /> : <RefreshCw size={32} />}
        </div>
        <p className="eyebrow">Итоги игры</p>
        <h1>
          {unavailable ? "Итоги пока недоступны" : "Не удалось загрузить итоги"}
        </h1>
        <p>
          {unavailable
            ? "После игры организатор сможет открыть эту страницу для всех. Если ссылка уже работала, публикация могла быть закрыта."
            : error || "Проверьте соединение и попробуйте ещё раз."}
        </p>
        <div className="results-empty-actions">
          <Link to="/" className="button secondary">
            <ArrowLeft size={17} /> На главную
          </Link>
          <button className="button primary" onClick={refresh}>
            <RefreshCw size={17} /> Проверить ещё раз
          </button>
        </div>
      </main>
    );
  }

  const teams = [...report.teams].sort((a, b) => b.score - a.score);
  const topScore = teams[0]?.score ?? 0;
  const winners = teams.filter((team) => team.score === topScore);
  const completed = report.rounds.filter((round) => round.completed);
  const guessed = report.rounds.reduce(
    (total, round) =>
      total +
      round.answers.filter(
        (answer) => answer.onBoard !== false && answer.opened,
      ).length,
    0,
  );
  const answers = report.rounds.reduce(
    (total, round) =>
      total +
      (round.boardAnswerCount ??
        round.answers.filter((answer) => answer.onBoard !== false).length),
    0,
  );
  const restored = report.rounds.some((round) => !round.completedAt);
  const bestRound = completed
    .filter((round) => round.winnerTeamId !== null)
    .sort((a, b) => b.awardedPoints - a.awardedPoints)[0];
  const visibleRounds =
    question === "all"
      ? report.rounds
      : report.rounds.filter(
          (round) => String(round.questionIndex) === question,
        );
  const partial = report.rounds.some((round) => !round.completed);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(
        `${location.origin}/results/${encodeURIComponent(report.id)}`,
      );
      setCopied(true);
      setCopyError("");
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopyError(
        "Не удалось скопировать ссылку. Её можно скопировать из адресной строки браузера.",
      );
    }
  };

  return (
    <div
      className="results-page"
      data-theme={isLightBrand(report.brand) ? "light" : "dark"}
      style={brandStyle(report.brand)}
    >
      <header className="results-navigation container">
        <Link to="/" className="results-brand" aria-label="На главную">
          {report.brand.gameLogoUrl || report.brand.logoUrl ? (
            <img
              src={report.brand.gameLogoUrl || report.brand.logoUrl}
              alt=""
            />
          ) : (
            <span className="results-brand-symbol">
              <Sparkles size={20} aria-hidden="true" />
            </span>
          )}
          <span>
            {report.brand.title}
            {report.brand.organizer && <small>{report.brand.organizer}</small>}
          </span>
        </Link>
        <Link className="button secondary small" to="/">
          <ArrowLeft size={16} /> На главную
        </Link>
      </header>

      <main className="container results-main">
        {!report.published && (
          <div className="results-preview-note" role="status">
            <Eye size={19} aria-hidden="true" />
            <span>
              <strong>Предпросмотр</strong> · итоги ещё не опубликованы. Гости
              пока не видят эту страницу.
            </span>
            <Link to={`/admin/games/${report.id}`}>
              Настроить публикацию <ArrowUpRight size={15} />
            </Link>
          </div>
        )}
        {error && (
          <div className="results-refresh-error" role="alert">
            <span>
              Не удалось обновить данные. Показаны последние загруженные итоги.
            </span>
            <button onClick={refresh}>
              <RefreshCw size={16} /> Повторить
            </button>
          </div>
        )}

        <section className="results-intro" aria-labelledby="results-heading">
          <div>
            <p className="results-kicker">
              <BarChart3 size={17} aria-hidden="true" /> Игра окончена. Ответы
              остаются.
            </p>
            <h1 id="results-heading">Итоги игры</h1>
            <p className="results-game-title">{report.title}</p>
            <p className="results-intro-description">
              Счёт команд, облака ответов и вся картина опроса — от популярных
              мнений до единственного необычного варианта.
            </p>
          </div>
          {report.published && (
            <div className="results-share">
              <button
                className="button primary"
                onClick={() => void copyLink()}
              >
                {copied ? <Check size={17} /> : <Clipboard size={17} />}
                {copied ? "Ссылка скопирована" : "Поделиться итогами"}
              </button>
              {copyError && <p role="alert">{copyError}</p>}
            </div>
          )}
        </section>

        <section
          className="results-scoreboard"
          aria-labelledby="results-score-heading"
        >
          <div className="results-scoreboard-title">
            <span className="results-trophy">
              <Trophy size={28} aria-hidden="true" />
            </span>
            <div>
              <p className="eyebrow">Финальный счёт</p>
              <h2 id="results-score-heading">
                {winners.length > 1
                  ? "Победила дружба — ничья!"
                  : "Есть победитель!"}
              </h2>
            </div>
          </div>
          <ol className="results-team-list">
            {teams.map((team, index) => (
              <li
                className={`results-team${team.score === topScore ? " results-team-winner" : ""}`}
                key={team.id}
              >
                <span
                  className="results-team-place"
                  aria-label={`${index === 0 || team.score !== teams[index - 1].score ? index + 1 : teams.findIndex((entry) => entry.score === team.score) + 1} место`}
                >
                  {teams.findIndex((entry) => entry.score === team.score) + 1}
                </span>
                <span className="results-team-name">
                  <strong>{team.name}</strong>
                  {team.score === topScore && (
                    <small>
                      {winners.length > 1
                        ? "Разделённое первое место"
                        : "Победитель игры"}
                    </small>
                  )}
                </span>
                <span className="results-team-score">
                  <strong>{number.format(team.score)}</strong>
                  <small>очков</small>
                </span>
              </li>
            ))}
          </ol>
        </section>

        {restored && (
          <p className="results-history-note">
            Показаны сохранённые сведения о ранее сыгранной партии. Данные об
            открытых ответах и начислении банка могут быть неполными.
          </p>
        )}
        <section className="results-metrics" aria-label="Игра в цифрах">
          <div className="results-metric">
            <BarChart3 size={21} aria-hidden="true" />
            <strong>
              {number.format(completed.length)}{" "}
              <small>из {number.format(report.totalRounds)}</small>
            </strong>
            <span>раундов завершено</span>
          </div>
          <div className="results-metric">
            <CheckCheck size={21} aria-hidden="true" />
            <strong>
              {number.format(guessed)}{" "}
              <small>из {number.format(answers)}</small>
            </strong>
            <span>
              {restored
                ? "открытий сохранилось в истории"
                : "ответов открыли в игре"}
            </span>
          </div>
          <div className="results-metric">
            <Trophy size={21} aria-hidden="true" />
            <strong>
              {restored && !bestRound
                ? "—"
                : number.format(bestRound?.awardedPoints ?? 0)}{" "}
              <small>очков</small>
            </strong>
            <span>
              {bestRound && bestRound.awardedPoints > 0
                ? `самый результативный раунд · № ${bestRound.questionIndex + 1}`
                : restored && !bestRound
                  ? "банк раундов не сохранился"
                  : "максимум за завершённый раунд"}
            </span>
          </div>
        </section>

        <ResultsAnalytics report={report} />

        <section
          className="results-questions"
          aria-labelledby="results-questions-heading"
        >
          <header className="results-questions-heading">
            <div>
              <p className="eyebrow">За каждым ответом — мнение</p>
              <h2 id="results-questions-heading">Как отвечали на вопросы</h2>
              <p>
                На игровом табло были самые популярные варианты. Здесь — все
                ответы на сыгранные вопросы, включая редкие. Сравнивайте их в
                списке или переключайтесь на облако ответов.
              </p>
            </div>
            {report.rounds.length > 1 && (
              <label className="results-question-filter">
                <span>Выбрать вопрос</span>
                <select
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                >
                  <option value="all">
                    Все вопросы · {report.rounds.length}
                  </option>
                  {report.rounds.map((round) => (
                    <option
                      key={round.questionIndex}
                      value={String(round.questionIndex)}
                    >
                      Вопрос {round.questionIndex + 1}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </header>
          {partial && (
            <div className="results-partial-note">
              <HelpCircle size={18} aria-hidden="true" />
              <p>
                Игра завершилась досрочно. Незавершённый раунд отмечен отдельно;
                вопросы, до которых не дошли, здесь не раскрываются.
              </p>
            </div>
          )}
          <div className="results-rounds">
            {visibleRounds.map((round) => (
              <RoundStatistics
                key={round.questionId}
                round={round}
                teams={report.teams}
              />
            ))}
            {report.rounds.length === 0 && (
              <div className="results-no-rounds">
                <BarChart3 size={30} aria-hidden="true" />
                <h3>В этой игре ещё не было вопросов</h3>
                <p>Игра завершилась до начала первого раунда.</p>
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="results-footer container">
        <div>
          {report.brand.logoUrl && (
            <img src={report.brand.logoUrl} alt="Логотип организатора" />
          )}
          <span>
            {[report.brand.organizer, report.brand.footerText]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        {report.brand.partnerLogoUrls.length > 0 && (
          <div className="results-partners" aria-label="Партнёры мероприятия">
            {report.brand.partnerLogoUrls.map((url, index) => (
              <img
                src={url}
                key={`${url}-${index}`}
                alt={`Логотип партнёра ${index + 1}`}
              />
            ))}
          </div>
        )}
        <Link to="/help">
          Как играть <ArrowUpRight size={14} />
        </Link>
      </footer>
    </div>
  );
}
