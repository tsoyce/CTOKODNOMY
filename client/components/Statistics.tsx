import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import { BarChart3, Check, Cloud, ListOrdered, Search, Trophy, X } from "lucide-react";
import type { PublicRoundStats, PublicTeam } from "../../shared/types";
import { answerStatistics, filterStatisticsAnswers, type AnswerFilter } from "../../shared/answerStatistics";
import "./Statistics.css";

const number = new Intl.NumberFormat("ru-RU");
const percent = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

function surveyDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
}

export function RoundStatistics({
  round,
  teams,
  compact = false,
  preferredView,
  preferenceRevision,
}: {
  round: PublicRoundStats;
  teams: PublicTeam[];
  compact?: boolean;
  preferredView?: "list" | "cloud";
  preferenceRevision?: number;
}) {
  const headingId = useId();
  const visualizationId = useId();
  const [order, setOrder] = useState<"popular" | "board">("popular");
  const [view, setView] = useState<"list" | "cloud">(preferredView ?? "list");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AnswerFilter>("all");
  const [selectedPosition, setSelectedPosition] = useState<number | null>(null);
  // A repeated command from the host must also override a local selection.
  useEffect(() => {
    if (preferredView) setView(preferredView);
    setQuery("");
    setFilter("all");
    setSelectedPosition(null);
  }, [round.questionId, round.questionIndex, preferredView, preferenceRevision]);
  const survey = useMemo(() => answerStatistics(round.answers), [round.answers]);
  const answers = useMemo(
    () =>
      filterStatisticsAnswers(survey.answers, query, filter).sort((a, b) =>
        order === "popular"
          ? b.points - a.points || a.position - b.position
          : a.position - b.position,
      ),
    [survey.answers, query, filter, order],
  );
  const cloudAnswers = useMemo(() => [...answers].sort((a, b) => b.points - a.points || a.position - b.position), [answers]);
  const selectedAnswer = answers.find((answer) => answer.position === selectedPosition);
  // Older saved reports contain only board answers and do not have onBoard.
  const boardAnswers = round.answers.filter((answer) => answer.onBoard !== false);
  const boardAnswerCount = round.boardAnswerCount ?? boardAnswers.length;
  const guessed = boardAnswers.filter((answer) => answer.opened).length;
  const winner = teams.find((team) => team.id === round.winnerTeamId);
  const date = surveyDate(round.surveyDate);
  const restored = !round.completedAt;
  const outsideBoardLabel =
    boardAnswerCount === 6 ? "Вне ТОП-6" : "Не было на табло";
  const resetFilters = () => { setQuery(""); setFilter("all"); setSelectedPosition(null); };

  return (
    <section
      className={`round-statistics${compact ? " round-statistics-compact" : ""}${round.answers.length > boardAnswerCount ? " round-statistics-full-survey" : ""}`}
      aria-labelledby={headingId}
    >
      <header className="statistics-header">
        <div>
          {compact ? (
            <h2 id={headingId}>Как отвечали на вопрос</h2>
          ) : (
            <>
              <p className="statistics-round-label">
                <BarChart3 size={16} aria-hidden="true" /> Вопрос{" "}
                {round.questionIndex + 1}
              </p>
              <h3 id={headingId}>{round.prompt}</h3>
            </>
          )}
        </div>
        <span className="statistics-guessed">
          <Check size={17} aria-hidden="true" />
          {restored ? "Сохранено открытий" : "Угадали"} {guessed} из{" "}
          {boardAnswerCount}
        </span>
      </header>

      <div className="statistics-summary">
        {winner ? (
          <p>
            <Trophy size={17} aria-hidden="true" />
            <span>
              Раунд забрала команда <strong>{winner.name}</strong>
            </span>
            <strong className="statistics-awarded">
              +{number.format(round.awardedPoints)} очков
            </strong>
          </p>
        ) : (
          <p>
            {round.completed
              ? "Детали начисления этого раунда не сохранились"
              : "Игра завершена досрочно · раунд не доигран"}
          </p>
        )}
        {round.multiplier !== 1 && <span>Множитель ×{round.multiplier}</span>}
      </div>

      <div className="statistics-chart-heading">
        <div className="statistics-chart-title">
          <strong>Все ответы опроса</strong>
          <span>
            Всего вариантов: {number.format(round.answers.length)} · На табло:{" "}
            {number.format(boardAnswerCount)}
          </span>
        </div>
        <div
          className="statistics-view-switch"
          role="group"
          aria-label="Вид статистики"
        >
          <button
            type="button"
            aria-pressed={view === "list"}
            aria-controls={visualizationId}
            onClick={() => setView("list")}
          >
            <BarChart3 size={17} aria-hidden="true" /> Список
          </button>
          <button
            type="button"
            aria-pressed={view === "cloud"}
            aria-controls={visualizationId}
            onClick={() => setView("cloud")}
          >
            <Cloud size={18} aria-hidden="true" /> Облако ответов
          </button>
        </div>
      </div>

      <div className="statistics-filters" role="group" aria-label="Поиск и фильтры ответов">
        <label className="statistics-search">
          <Search size={17} aria-hidden="true" />
          <input type="search" aria-label="Поиск по ответам" placeholder="Найти ответ…" value={query}
            onChange={(event) => { setQuery(event.target.value); setSelectedPosition(null); }} />
        </label>
        <select aria-label="Фильтр ответов" value={filter} onChange={(event) => { setFilter(event.target.value as AnswerFilter); setSelectedPosition(null); }}>
          <option value="all">Все ответы</option>
          <option value="board">{boardAnswerCount === 6 ? "ТОП-6 на табло" : "На табло"}</option>
          <option value="outside">{boardAnswerCount === 6 ? "Вне ТОП-6" : "Вне табло"}</option>
          <option value="opened">Угаданные</option>
        </select>
        {(query || filter !== "all") && <button type="button" onClick={resetFilters}>Сбросить фильтры</button>}
        <span className="statistics-filter-count" aria-live="polite">Показано {number.format(answers.length)} из {number.format(round.answers.length)}</span>
      </div>

      <div className="statistics-visualization" id={visualizationId}>
        {answers.length === 0 && <p className="statistics-empty" role="status">По этим условиям ответов нет. Измените поиск или сбросьте фильтры.</p>}
        {view === "cloud" ? (
          <>
            <p className="statistics-cloud-note">
              Популярные ответы крупнее. Нажмите на ответ, чтобы увидеть его долю и результат в игре.
            </p>
            <ul
              className="statistics-answer-cloud"
              aria-label="Облако всех ответов опроса"
              tabIndex={0}
            >
              {cloudAnswers.map((answer) => (
                  <li
                    key={answer.position}
                    className={`statistics-cloud-word${answer.onBoard === false ? " statistics-cloud-word-extra" : ""}`}
                    style={
                      {
                        "--cloud-weight": answer.cloudWeight,
                      } as CSSProperties
                    }
                  >
                    <button type="button" aria-label={`Подробнее об ответе: ${answer.text}`}
                      aria-pressed={selectedAnswer?.position === answer.position}
                      onClick={() => setSelectedPosition((current) => current === answer.position ? null : answer.position)}>
                    <span className="statistics-cloud-phrase">
                      {answer.text}
                    </span>
                    <span
                      className="statistics-cloud-count"
                      aria-label={`Вес ответа: ${number.format(answer.points)}`}
                    >
                      {number.format(answer.points)}
                    </span>
                    {answer.onBoard === false && (
                      <span className="statistics-cloud-status">
                        {outsideBoardLabel}
                      </span>
                    )}
                    </button>
                  </li>
                ))}
            </ul>
            {selectedAnswer && <section className="statistics-answer-detail" aria-label="Подробности ответа">
              <div><strong>{selectedAnswer.text}</strong><span>Вес: {number.format(selectedAnswer.points)} · Доля: {percent.format(selectedAnswer.share)}% всех весов</span>
                <span>{selectedAnswer.onBoard ? `${boardAnswerCount === 6 ? "ТОП-6 на табло" : "На табло"} · ${selectedAnswer.opened ? "Угадали" : "Не открыли в игре"}` : outsideBoardLabel}</span></div>
              <button type="button" aria-label="Закрыть подробности" onClick={() => setSelectedPosition(null)}><X size={20} aria-hidden="true" /></button>
            </section>}
          </>
        ) : (
          <>
            <div className="statistics-list-heading">
              <span>Все ответы и их вес в опросе</span>
              <label>
                <ListOrdered size={16} aria-hidden="true" />
                <span className="sr-only">Порядок ответов</span>
                <select
                  aria-label="Порядок ответов"
                  value={order}
                  onChange={(event) =>
                    setOrder(event.target.value as "popular" | "board")
                  }
                >
                  <option value="popular">По популярности</option>
                  <option value="board">По порядку вариантов</option>
                </select>
              </label>
            </div>
            <ol
              className="statistics-answer-list"
              tabIndex={compact ? 0 : undefined}
              aria-label="Все ответы опроса"
            >
              {answers.map((answer) => {
                const share = Number.isFinite(answer.share)
                  ? Math.max(0, Math.min(100, answer.share))
                  : 0;
                return (
                  <li
                    className={
                      answer.onBoard !== false && answer.opened
                        ? "statistics-answer guessed"
                        : `statistics-answer${answer.onBoard === false ? " statistics-answer-extra" : ""}`
                    }
                    key={answer.position}
                  >
                    <span
                      className="statistics-answer-position"
                      aria-label={`Ответ ${answer.position}`}
                    >
                      {String(answer.position).padStart(2, "0")}
                    </span>
                    <div className="statistics-answer-main">
                      <div className="statistics-answer-caption">
                        <strong>{answer.text}</strong>
                        <span className="statistics-answer-weight">
                          {number.format(answer.points)} <small>вес</small>
                        </span>
                      </div>
                      <div className="statistics-bar-row">
                        <div className="statistics-bar-track" aria-hidden="true">
                          <div
                            className="statistics-bar"
                            style={{ width: `${share}%` }}
                          />
                        </div>
                        <span
                          className="statistics-answer-share"
                          aria-label={`${percent.format(share)} процентов суммы весов всех ответов`}
                        >
                          {percent.format(share)}%
                        </span>
                      </div>
                      <span className="statistics-answer-outcome">
                        {answer.onBoard === false ? (
                          outsideBoardLabel
                        ) : answer.opened ? (
                          <>
                            <Check size={14} aria-hidden="true" /> Угадали
                          </>
                        ) : restored ? (
                          "Открытие не сохранилось в истории"
                        ) : (
                          "Не открыли в игре"
                        )}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>

      <footer className="statistics-source">
        <p className="statistics-denominator">
          Проценты — доля суммы весов всех ответов опроса, а не доля опрошенных.
          {survey.totalWeight === 0 && " Сумма весов равна нулю."}
        </p>
        {restored && (
          <p>
            Это ранее сыгранный раунд: часть сведений о ходе игры могла не
            сохраниться.
          </p>
        )}
        <div className="statistics-source-details">
          {round.isDemo && (
            <strong className="statistics-demo-label">
              Учебный вопрос · ответы условные
            </strong>
          )}
          <span>Источник: {round.source || "не указан"}</span>
          {date && <span>Дата опроса: {date}</span>}
          {round.respondentCount !== null && (
            <span>Опрошено: {number.format(round.respondentCount)}</span>
          )}
        </div>
      </footer>
    </section>
  );
}
