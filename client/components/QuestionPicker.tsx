import { useState } from "react";
import { ArrowDown, ArrowUp, Layers3, Search, X } from "lucide-react";
import { questionPacks } from "../../shared/questionPacks";
import type { Question } from "../../shared/types";
import { answerSummary } from "./AdminCommon";
import { ErrorMessage } from "./Common";
import "./QuestionPicker.css";

const MAX_GAME_ROUNDS = 20;

interface QuestionPickerProps {
  questions: Question[];
  selected: string[];
  multiplierById: Record<string, number>;
  onSelectionChange: (ids: string[]) => void;
  onMultiplierChange: (id: string, multiplier: number) => void;
}

export function QuestionPicker({
  questions,
  selected,
  multiplierById,
  onSelectionChange,
  onMultiplierChange,
}: QuestionPickerProps) {
  const [search, setSearch] = useState("");
  const [packName, setPackName] = useState<string | null>(null);
  const [error, setError] = useState("");
  const packs = questionPacks(questions);
  const pack = packName === null ? undefined : packs.find((group) => group.name === packName);
  const query = search.trim().toLocaleLowerCase("ru");
  const visible = questions.filter((question) =>
    (packName === null || (question.pack || "") === packName) &&
    `${question.prompt} ${question.pack}`.toLocaleLowerCase("ru").includes(query),
  );
  const selectedSet = new Set(selected);
  const visibleSelected = visible.filter((question) => selectedSet.has(question.id)).length;
  const applySelection = (ids: string[]) => {
    const unique = [...new Set(ids)];
    if (unique.length > MAX_GAME_ROUNDS) {
      setError(`Получится ${unique.length} раундов. В одной игре может быть до ${MAX_GAME_ROUNDS}. Выбор не изменён: добавьте меньше вопросов или уберите часть выбранных.`);
      return;
    }
    setError("");
    onSelectionChange(unique);
  };
  const toggle = (id: string) => applySelection(
    selectedSet.has(id) ? selected.filter((item) => item !== id) : [...selected, id],
  );
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= selected.length) return;
    const next = [...selected];
    [next[index], next[target]] = [next[target], next[index]];
    applySelection(next);
  };
  return (
    <div className="question-picker-workspace">
      <div className="question-pack-picker">
        <div className="question-pack-heading">
          <Layers3 size={22} aria-hidden="true" />
          <div>
            <h3>Вся игра из одного набора</h3>
            <p className="muted">Выберите готовый набор или соберите раунды из разных вопросов. До 20 раундов в игре.</p>
          </div>
        </div>
        <label className="field">
          Набор вопросов
          <select
            aria-label="Набор вопросов"
            value={packName === null ? "" : `pack:${packName}`}
            onChange={(event) => {
              setPackName(event.target.value ? event.target.value.slice(5) : null);
              setError("");
            }}
          >
            <option value="">Все вопросы · {questions.length}</option>
            {packs.map((group) => (
              <option key={group.name} value={`pack:${group.name}`}>
                {group.name || "Без набора"} · {group.questions.length}
                {group.questions.every((question) => question.isDemo) ? " · Демо" : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="question-pack-actions">
          <button
            type="button"
            className="button button-primary"
            disabled={!pack}
            onClick={() => pack && applySelection(pack.questions.map((question) => question.id))}
          >
            Выбрать набор целиком
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={!pack}
            onClick={() => pack && applySelection([...selected, ...pack.questions.map((question) => question.id)])}
          >
            Добавить набор к выбранным
          </button>
        </div>
        <p className="muted question-pack-note">
          «Выбрать набор целиком» заменит текущий список раундов всеми вопросами набора, независимо от поиска. «Добавить» сохранит выбранные раунды и добавит остальные без повторов.
        </p>
      </div>
      {error && <ErrorMessage message={error} />}
      <div className="question-picker-grid">
        <div className="question-picker-library">
          <label className="search-field">
            <Search size={18} aria-hidden="true" />
            <input
              aria-label="Поиск вопросов"
              placeholder="Найти вопрос или набор"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
            />
          </label>
          <div className="question-visible-actions">
            <span className="muted" role="status">Найдено: {visible.length} · выбрано: {visibleSelected}</span>
            <div>
              <button
                className="button button-secondary"
                type="button"
                disabled={!visible.length || visibleSelected === visible.length}
                onClick={() => applySelection([...selected, ...visible.map((question) => question.id)])}
              >Добавить найденные</button>
              <button
                className="button button-secondary"
                type="button"
                disabled={!visibleSelected}
                onClick={() => {
                  const ids = new Set(visible.map((question) => question.id));
                  applySelection(selected.filter((id) => !ids.has(id)));
                }}
              >Убрать найденные</button>
            </div>
          </div>
          <div className="question-picker">
            {visible.length ? visible.map((question) => (
              <label
                className={`question-option ${selectedSet.has(question.id) ? "selected" : ""}`}
                key={question.id}
              >
                <input
                  type="checkbox"
                  checked={selectedSet.has(question.id)}
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
            )) : (
              <p className="muted question-picker-empty">Вопросы не найдены. Измените поиск или выберите другой набор.</p>
            )}
          </div>
        </div>
        <div className="selected-questions">
          <div className="selected-questions-heading">
            <h3>Порядок раундов <span className="badge">{selected.length} / {MAX_GAME_ROUNDS}</span></h3>
            <button
              type="button"
              className="button button-secondary"
              disabled={!selected.length}
              onClick={() => applySelection([])}
            >Очистить выбор</button>
          </div>
          {selected.length ? selected.map((id, index) => (
            <div key={id} className="selected-question">
              <span className="round-number">{index + 1}</span>
              <div>
                <strong>{questions.find((question) => question.id === id)?.prompt}</strong>
                <label className="multiplier-field">
                  Очки
                  <select
                    aria-label="Очки"
                    value={multiplierById[id] || 1}
                    onChange={(event) => onMultiplierChange(id, Number(event.target.value))}
                  >
                    <option value={1}>×1</option>
                    <option value={2}>×2</option>
                    <option value={3}>×3</option>
                  </select>
                </label>
              </div>
              <div className="reorder-actions">
                <button type="button" className="icon-button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Поднять раунд ${index + 1}`}>
                  <ArrowUp size={16} />
                </button>
                <button type="button" className="icon-button" onClick={() => move(index, 1)} disabled={index === selected.length - 1} aria-label={`Опустить раунд ${index + 1}`}>
                  <ArrowDown size={16} />
                </button>
                <button type="button" className="icon-button" onClick={() => toggle(id)} aria-label={`Убрать раунд ${index + 1}`}>
                  <X size={16} />
                </button>
              </div>
            </div>
          )) : (
            <div className="muted selected-placeholder">Выберите набор целиком или отметьте вопросы слева. Здесь появится сценарий вечера.</div>
          )}
        </div>
      </div>
    </div>
  );
}
