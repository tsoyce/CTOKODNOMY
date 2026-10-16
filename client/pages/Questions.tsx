import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Check, Download, FileQuestion, Folder, FolderInput, Pencil, Plus, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import type { Question } from "../../shared/types";
import { MAX_QUESTION_BATCH, questionPacks } from "../../shared/questionPacks";
import { api } from "../lib";
import { ErrorMessage, Loading } from "../components/Common";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CollapsibleCard } from "../components/CollapsibleCard";
import { PageHeading, EmptyState, useResource, json, messageOf, answerSummary } from "../components/AdminCommon";
import "./Admin.css";
import "./Questions.css";

export function QuestionsPage() {
  const {
    value: questions,
    setValue: setQuestions,
    loading,
    error,
    refresh,
  } = useResource<Question[]>("/questions");
  const [search, setSearch] = useState("");
  const [pack, setPack] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const busyLock = useRef(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveTarget, setMoveTarget] = useState("");
  const [newPackName, setNewPackName] = useState("");
  const [renameFrom, setRenameFrom] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [bulkDeleting, setBulkDeleting] = useState<{ id: string; prompt: string }[] | null>(null);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [demoConfirm, setDemoConfirm] = useState(false);
  const groups = questionPacks(questions || []);
  const packs = groups.map((group) => group.name).filter(Boolean);
  const validMoveTarget = moveTarget === "new" || (
    Boolean(moveTarget) && packs.includes(JSON.parse(moveTarget) as string)
  );
  const filtered = (questions || []).filter(
    (question) =>
      `${question.prompt} ${question.source} ${question.pack}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (pack === null || (question.pack || "") === pack) &&
      (filter === "all" || question.isDemo === (filter === "demo")),
  );
  // Filtered-out selections never become an implicit target of a batch action.
  const visibleIds = new Set(filtered.map((question) => question.id));
  const availableIds = new Set((questions || []).map((question) => question.id));
  const selectedVisible = filtered.filter((question) => selected.has(question.id));
  const selectedHidden = (questions || []).filter(
    (question) => selected.has(question.id) && !visibleIds.has(question.id),
  ).length;
  const selectedCount = selectedVisible.length + selectedHidden;
  const run = async (action: () => Promise<void>) => {
    if (busyLock.current) return;
    busyLock.current = true;
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      await action();
    } catch (err) {
      setActionError(messageOf(err));
    } finally {
      busyLock.current = false;
      setBusy(false);
    }
  };
  const clearIds = (ids: string[]) => {
    const affected = new Set(ids);
    setSelected((current) => new Set([...current].filter((id) => !affected.has(id))));
  };
  const selectAllVisible = () => {
    const next = new Set([...selected].filter((id) => availableIds.has(id)));
    for (const question of filtered) next.add(question.id);
    if (next.size > MAX_QUESTION_BATCH) {
      setActionError(`За один раз можно выбрать до ${MAX_QUESTION_BATCH} вопросов. Уточните фильтры или снимите прежний выбор.`);
      return;
    }
    setActionError("");
    setSelected(next);
  };
  const remove = (id: string) => run(async () => {
    await api(`/questions/${id}`, json("DELETE"));
    setQuestions((questions || []).filter((question) => question.id !== id));
    setDeleting(null);
    clearIds([id]);
    await refresh();
    setNotice("Вопрос удалён из библиотеки. Снимки уже созданных игр сохранены.");
  });
  const exportQuestions = () => run(async () => {
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
  });
  const addDemos = () => run(async () => {
    const result = await api<{ count: number }>("/questions/demo", json("POST", {}));
    await refresh();
    setDemoConfirm(false);
    setNotice(`Добавлено ${result.count} демовопроса. Их ответы и очки вымышлены и помечены для репетиции.`);
  });
  const moveSelected = (target: string) => {
    const ids = selectedVisible.map((question) => question.id);
    if (!ids.length) return;
    void run(async () => {
      const result = await api<{ count: number }>("/questions/batch", json("POST", { action: "move", ids, pack: target }));
      const affected = new Set(ids);
      setQuestions((questions || []).map((question) => affected.has(question.id) ? { ...question, pack: target } : question));
      clearIds(ids);
      await refresh();
      setNotice(target ? `В набор «${target}» добавлено вопросов: ${result.count}.` : `Из наборов убрано вопросов: ${result.count}. Сами вопросы остались в библиотеке.`);
    });
  };
  const submitMove = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validMoveTarget) return;
    const target = moveTarget === "new" ? newPackName.trim() : moveTarget ? JSON.parse(moveTarget) as string : "";
    if (target) moveSelected(target);
  };
  const renamePack = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const from = renameFrom;
    const to = renameTo.trim();
    if (from === null || !to || from === to) return;
    void run(async () => {
      const result = await api<{ count: number; pack: string }>("/questions/packs/rename", json("POST", { from, to }));
      setQuestions((questions || []).map((question) => question.pack === from ? { ...question, pack: result.pack } : question));
      if (pack === from) setPack(result.pack);
      if (moveTarget === JSON.stringify(from)) setMoveTarget(JSON.stringify(result.pack));
      setRenameFrom(null);
      await refresh();
      setNotice(`Набор переименован в «${result.pack}». Вопросов: ${result.count}. Названия в уже созданных играх не изменены.`);
    });
  };
  const deleteSelected = () => {
    if (!bulkDeleting?.length) return;
    const ids = bulkDeleting.map(({ id }) => id);
    void run(async () => {
      const result = await api<{ count: number }>("/questions/batch", json("POST", { action: "delete", ids }));
      const affected = new Set(ids);
      setQuestions((questions || []).filter((question) => !affected.has(question.id)));
      clearIds(ids);
      setBulkDeleting(null);
      await refresh();
      setNotice(`Из библиотеки удалено вопросов: ${result.count}. Снимки уже созданных игр сохранены.`);
    });
  };
  if (loading) return <Loading />;
  return (
    <>
      <PageHeading
        eyebrow="Основа хорошей игры"
        title="Библиотека вопросов"
        description="Объединяйте вопросы в наборы, чтобы добавлять их в игру одним выбором. Ответы, очки и источники хранятся вместе."
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
      {actionError && !bulkDeleting && <ErrorMessage message={actionError} />}
      {notice && (
        <p className="success-message" role="status">
          <Check size={17} />
          {notice}
        </p>
      )}
      {groups.length > 0 && (
        <section className="library-packs" aria-label="Наборы вопросов">
          <div className="library-packs-heading">
            <div>
              <h2>Наборы вопросов</h2>
              <p className="muted">Один набор — готовая подборка для игры. Название можно изменить после импорта.</p>
            </div>
            <button type="button" className="button button-ghost" disabled={busy} onClick={() => setPack(null)} aria-pressed={pack === null}>Все вопросы</button>
          </div>
          <div className="library-pack-grid">
            {groups.map((group) => (
              <article key={group.name} className={`library-pack-card ${pack === group.name ? "is-active" : ""}`}>
                <button
                  type="button"
                  className="library-pack-open"
                  aria-label={`Показать набор: ${group.name || "Без набора"}`}
                  aria-pressed={pack === group.name}
                  aria-expanded={pack === group.name}
                  disabled={busy}
                  onClick={() => setPack((current) => current === group.name ? null : group.name)}
                >
                  <Folder size={21} aria-hidden="true" />
                  <span><strong>{group.name || "Без набора"}</strong><small>{group.questions.length} вопросов</small></span>
                </button>
                {group.name && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Переименовать набор: ${group.name}`}
                    disabled={busy}
                    onClick={() => { setRenameFrom(group.name); setRenameTo(group.name); setActionError(""); }}
                  ><Pencil size={17} /></button>
                )}
              </article>
            ))}
          </div>
          {renameFrom !== null && (
            <form className="library-rename-form" onSubmit={renamePack}>
              <label>
                <span>Новое название набора</span>
                <input value={renameTo} onChange={(event) => setRenameTo(event.target.value)} maxLength={100} required autoFocus disabled={busy} />
              </label>
              <p className="muted">Переименовываем «{renameFrom}». Вопросы и их порядок сохранятся. Для объединения наборов используйте «В набор» ниже.</p>
              <div className="actions">
                <button type="submit" className="button button-primary" disabled={busy || !renameTo.trim() || renameTo.trim() === renameFrom}>Сохранить название</button>
                <button type="button" className="button button-ghost" disabled={busy} onClick={() => setRenameFrom(null)}>Отмена</button>
              </div>
            </form>
          )}
        </section>
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
          value={pack === null ? "" : JSON.stringify(pack)}
          onChange={(event) => setPack(event.target.value ? JSON.parse(event.target.value) as string : null)}
        >
          <option value="">Все наборы</option>
          {pack !== null && !groups.some((group) => group.name === pack) && (
            <option value={JSON.stringify(pack)}>{pack || "Без набора"} · пусто</option>
          )}
          {groups.map(({ name }) => (
            <option key={name} value={JSON.stringify(name)}>{name || "Без набора"}</option>
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
      <div className="library-selection-toolbar">
        <p className="muted" role="status">Показано {filtered.length} из {questions?.length || 0} · выбрано {selectedCount}</p>
        <div className="actions">
          <button type="button" className="button button-secondary" disabled={busy || !filtered.length || selectedVisible.length === filtered.length} onClick={selectAllVisible}>Выбрать все показанные</button>
          <button type="button" className="button button-ghost" disabled={busy || !selectedCount} onClick={() => setSelected(new Set())}>Снять весь выбор</button>
          <button type="button" className="icon-button" aria-label="Обновить список вопросов" disabled={busy} onClick={() => void run(async () => { await refresh(); })}><RefreshCw size={17} /></button>
        </div>
      </div>
      {selectedCount > 0 && (
        <section className="library-batch-panel" aria-label="Действия с выбранными вопросами" aria-busy={busy}>
          <div className="library-batch-summary">
            <strong>Выбрано в списке: {selectedVisible.length}</strong>
            <span className="muted">{selectedHidden ? `Ещё ${selectedHidden} скрыто фильтрами — эти вопросы не затрагиваются.` : "Действия применяются только к выбранным вопросам в текущем списке."}</span>
          </div>
          <form className="library-move-form" onSubmit={submitMove}>
            <label>
              <span>Набор для выбранных вопросов</span>
              <select aria-label="Набор для выбранных вопросов" value={validMoveTarget ? moveTarget : ""} onChange={(event) => setMoveTarget(event.target.value)} disabled={busy}>
                <option value="">Выберите набор…</option>
                {packs.map((name) => <option key={name} value={JSON.stringify(name)}>{name}</option>)}
                <option value="new">+ Новый набор</option>
              </select>
            </label>
            {moveTarget === "new" && (
              <label>
                <span>Название нового набора</span>
                <input value={newPackName} onChange={(event) => setNewPackName(event.target.value)} maxLength={100} required disabled={busy} placeholder="Например, Опрос ко Дню социолога" />
              </label>
            )}
            <button type="submit" className="button button-primary" disabled={busy || !selectedVisible.length || !validMoveTarget || (moveTarget === "new" && !newPackName.trim())}><FolderInput size={17} />В набор</button>
          </form>
          <div className="library-batch-secondary">
            <button type="button" className="button button-secondary" disabled={busy || !selectedVisible.some((question) => Boolean(question.pack))} onClick={() => moveSelected("")}>Убрать из набора</button>
            <button type="button" className="button button-danger" disabled={busy || !selectedVisible.length} onClick={() => { setBulkDeleting(selectedVisible.map(({ id, prompt }) => ({ id, prompt }))); setActionError(""); }}><Trash2 size={17} />Удалить выбранные</button>
          </div>
        </section>
      )}
      {filtered.length ? (
        <div className="question-library">
          {filtered.map((question) => (
            <article key={question.id} className={`card question-library-row ${selected.has(question.id) ? "is-selected" : ""}`}>
              <label className="question-row-check">
                <input
                  type="checkbox"
                  aria-label={`Выбрать вопрос: ${question.prompt}`}
                  checked={selected.has(question.id)}
                  disabled={busy || (!selected.has(question.id) && selectedCount >= MAX_QUESTION_BATCH)}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setSelected((current) => {
                      const next = new Set(current);
                      if (checked) next.add(question.id); else next.delete(question.id);
                      return next;
                    });
                  }}
                />
              </label>
              <CollapsibleCard
                className="question-library-disclosure"
                defaultOpen={false}
                header={<>
                  <div className="actions">
                    {question.pack && <span className="badge">{question.pack}</span>}
                    {question.isDemo && <span className="badge badge-demo">Демо · вымышленные данные</span>}
                  </div>
                  <h2>{question.prompt}</h2>
                </>}
              >
              <div className="question-library-main">
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
              </CollapsibleCard>
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
                  setPack(null);
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
      {bulkDeleting && (
        <ConfirmDialog
          title="Удалить выбранные вопросы?"
          description={<>
            <p>Будет удалено вопросов из библиотеки: <strong>{bulkDeleting.length}</strong>.</p>
            <ul className="library-delete-preview" tabIndex={0} aria-label="Вопросы для удаления">
              {bulkDeleting.slice(0, 10).map(({ id, prompt }) => <li key={id}>{prompt}</li>)}
            </ul>
            {bulkDeleting.length > 10 && <p className="muted">И ещё {bulkDeleting.length - 10} вопросов из выбранных.</p>}
            <p>Вернуть их можно будет только повторным импортом. Снимки уже созданных игр и их результаты сохранятся. Скрытые фильтрами вопросы не затрагиваются.</p>
          </>}
          confirmLabel="Удалить вопросы"
          busy={busy}
          error={actionError}
          danger
          onConfirm={deleteSelected}
          onCancel={() => { if (!busyLock.current) { setBulkDeleting(null); setActionError(""); } }}
        />
      )}
      <p className="muted library-note">
        В мастере импорта можно загрузить файл или вставить JSON, проверить
        ошибки и просмотреть ответы перед сохранением. Экспорт сохраняет всю
        библиотеку в формате <code>ctokodnomy-questions-v1</code>.
      </p>
    </>
  );
}
