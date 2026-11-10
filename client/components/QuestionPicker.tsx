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
  mode?: "standard" | "classic";
}

const CLASSIC_SLOTS = [
  "Раунд 1 · простая игра ×1",
  "Раунд 2 · двойная игра ×2",
  "Раунд 3 · тройная игра ×3",
  "Раунд 4 · игра наоборот",
  "Финал · вопрос 1",
  "Финал · вопрос 2",
  "Финал · вопрос 3",
  "Финал · вопрос 4",
  "Финал · вопрос 5",
  "Тай-брейк · дополнительный вопрос",
];

export function QuestionPicker({
  questions,
  selected,
  multiplierById,
  onSelectionChange,
  onMultiplierChange,
  mode = "standard",
}: QuestionPickerProps) {
  const [search, setSearch] = useState("");
  const [packName, setPackName] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [replacingId, setReplacingId] = useState<string | null>(null);
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
  const replace = (index: number, nextId: string) => {
    const previousId = selected[index];
    if (!previousId || nextId === previousId || selectedSet.has(nextId)) return;
    const next = [...selected];
    next[index] = nextId;
    applySelection(next);
    onMultiplierChange(nextId, multiplierById[previousId] || 1);
    setReplacingId(null);
  };
  if (mode === "classic") {
    const slots = CLASSIC_SLOTS.map((_, index) => selected[index] || "");
    const chosen = new Set(slots.filter(Boolean));
    return (
      <div className="question-picker-workspace classic-question-picker">
        <div className="classic-pack-picker">
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
              <option value="">Выберите набор</option>
              {packs.map((group) => (
                <option key={group.name} value={`pack:${group.name}`}>
                  {group.name || "Без набора"} · {group.questions.length}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button button-secondary"
            disabled={!pack}
            onClick={() => {
              if (!pack) return;
              if (pack.questions.length > CLASSIC_SLOTS.length) {
                setError("В наборе больше 10 вопросов. Выберите нужные вопросы для раундов по отдельности.");
                return;
              }
              setError("");
              const ids = pack.questions.map((question) => question.id);
              onSelectionChange(CLASSIC_SLOTS.map((_, index) => ids[index] || ""));
            }}
          >Заполнить из набора</button>
          <p className="muted">Набор заполняет раунды по порядку и заменяет текущий выбор. Каждый вопрос можно изменить отдельно.</p>
        </div>
        {error && <ErrorMessage message={error} />}
        <div className="classic-rounds-heading">
          <h3>Вопросы по раундам</h3>
          <span className="muted" role="status">Обязательных выбрано: {slots.slice(0, 9).filter(Boolean).length} / 9</span>
        </div>
        <p className="muted">Выберите разные вопросы для каждого раунда. Десятый вопрос пригодится при равном счёте и необязателен.</p>
        <div className="classic-rounds-list">
          {CLASSIC_SLOTS.map((label, index) => (
            <label className="classic-round-field" key={label}>
              <span>{label}{index === 9 ? " · необязательно" : ""}</span>
              <select
                aria-label={label}
                value={slots[index]}
                onChange={(event) => {
                  const next = [...slots];
                  next[index] = event.target.value;
                  onSelectionChange(next);
                  setError("");
                }}
              >
                <option value="">{index === 9 ? "Без тай-брейка" : "Выберите вопрос"}</option>
                {packs.map((group) => (
                  <optgroup key={group.name} label={group.name || "Без набора"}>
                    {group.questions.map((question) => (
                      <option key={question.id} value={question.id} disabled={question.id !== slots[index] && chosen.has(question.id)}>
                        {question.prompt}{question.id !== slots[index] && chosen.has(question.id) ? " · уже выбран" : ""}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="question-picker-workspace">
      <div className="question-pack-picker">
        <div className="question-pack-heading">
          <Layers3 size={22} aria-hidden="true" />
          <div>
            <h3>Вопросы для раундов</h3>
            <p className="muted">Выберите готовый набор или соберите игру из отдельных вопросов. Каждый выбранный вопрос станет отдельным раундом. До 20 раундов в игре.</p>
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
                    {selectedSet.has(question.id) ? ` · Раунд ${selected.indexOf(question.id) + 1}` : ""}
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
                <strong>{questions.find((question) => question.id === id)?.prompt || "Вопрос не найден в библиотеке"}</strong>
                {replacingId === id ? (
                  <div className="round-question-replacement">
                    <label>
                      Вопрос для раунда {index + 1}
                      <select
                        autoFocus
                        aria-label={`Вопрос для раунда ${index + 1}`}
                        value={id}
                        onChange={(event) => replace(index, event.target.value)}
                      >
                        {packs.map((group) => (
                          <optgroup key={group.name} label={group.name || "Без набора"}>
                            {group.questions.map((question) => (
                              <option key={question.id} value={question.id} disabled={question.id !== id && selectedSet.has(question.id)}>
                                {question.prompt}{question.id !== id && selectedSet.has(question.id) ? " · уже выбран" : ""}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </label>
                    <button type="button" className="round-replace-cancel" onClick={() => setReplacingId(null)}>
                      Отмена
                    </button>
                  </div>
                ) : (
                  <button type="button" className="round-replace-button" onClick={() => setReplacingId(id)}>
                    Заменить вопрос
                  </button>
                )}
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
