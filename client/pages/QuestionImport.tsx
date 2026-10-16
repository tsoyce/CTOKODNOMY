import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clipboard,
  Download,
  FileJson,
  FileUp,
  Sparkles,
} from "lucide-react";
import {
  IMPORT_MAX_BYTES,
  parseQuestionPack,
  type QuestionImportIssue,
  type QuestionPack,
} from "../../shared/questionImport";
import {
  boardAnswers,
  GAME_ANSWER_LIMIT,
  MAX_QUESTION_ANSWERS,
  rankedAnswers,
} from "../../shared/questionAnswers";
import type { Question } from "../../shared/types";
import { ApiError, api } from "../lib";
import { CollapsibleCard } from "../components/CollapsibleCard";
import "./QuestionImport.css";

const EXAMPLE_PACK = {
  format: "ctokodnomy-questions-v1",
  questions: [
    {
      prompt: "Учебный пример: что берут с собой на прогулку?",
      answers: [
        { text: "Воду", points: 40, aliases: ["Бутылку воды"], originals: ["Водичку", "Бутылку воды"] },
        { text: "Телефон", points: 20, aliases: ["Смартфон"] },
        { text: "Хорошее настроение", points: 10, aliases: [] },
        { text: "Ключи", points: 8, aliases: [] },
        { text: "Зонт", points: 7, aliases: [] },
        { text: "Наушники", points: 5, aliases: [] },
        { text: "Перекус", points: 3, aliases: [] },
        { text: "Фотоаппарат", points: 2, aliases: [] },
      ],
      source: "Учебный пример, реальный опрос не проводился",
      surveyDate: "",
      respondentCount: null,
      notes: "Вымышленные ответы и условные очки. На табло — 6 самых популярных групп, в статистике — все 8. Исходные формулировки — примеры словоупотребления, а не полный список анкет.",
      isDemo: true,
      pack: "Проверка импорта",
    },
  ],
};

const AI_PROMPT = `Подготовь вопросы для игры «100 к 1» из приложенной выгрузки опроса.
Используй только сведения из выгрузки. Не выдумывай ответы, количества, источник, дату и число опрошенных. Не включай имена, контакты и другие персональные данные участников.
Объединяй одинаковые по смыслу ответы только после описания групп и проверки частот. При неоднозначности сначала задай мне вопрос. Не смешивай число людей с числом выбранных ими ответов.
Если в одной анкете перечислено несколько вариантов, учитывай только первый выбранный ответ по смыслу, а не первое слово. Например, «голову, ручку» — «голову»; «телефон не беру, беру воду» — «воду». Неясные случаи вынеси на проверку, не разрезай текст автоматически. Сохрани исходную фразу без персональных данных в originals соответствующей группы, методику и неоднозначности — в notes.
Сохрани все группы, включая единичные и редкие: игра сама выберет ${GAME_ANSWER_LIMIT} ответов с наибольшими points для табло, а статистика покажет все. При равных очках сохраняется порядок answers; если равны 6-й и 7-й варианты, отдельно покажи мне границу отбора. Не обрезай список и не пересчитывай сумму к 100.
text — подпись для гостей. Для грубых или спорных фраз предложи нейтральную подпись с сохранением смысла; исходные фразы оставь в originals для организатора. Не считай замену согласованной автоматически: перечисли такие случаи перед финальным JSON. aliases — синонимы для ведущего, originals — исходные фразы, они не публикуются. Не включай имена и контакты даже в originals.
Неизвестное число опрошенных — null; неизвестные источник и дата — пустые строки. Дата, если известна, — YYYY-MM-DD. points — целые игровые веса от 0 до 1000. Сохраняй реальные частоты; если нужны выбор вариантов или пересчёт очков, сначала предложи правило и дождись моего решения. Опиши согласованное правило в notes.
Формат JSON: format строго "ctokodnomy-questions-v1", questions от 1 до 500. У каждого вопроса prompt от 1 до 500 символов и answers от 1 до ${MAX_QUESTION_ANSWERS}. У ответа text от 1 до 200 символов, points — целое число 0–1000, aliases — до 30 непустых синонимов по 1–200 символов, необязательный originals — до 100 непустых исходных фраз по 1–500 символов. originals не является списком респондентов и не определяет points. Не повторяй тексты ответов внутри вопроса. source — до 1000 символов, surveyDate — до 40, respondentCount — целое 1–1000000 или null, notes — до 4000, pack — название набора до 100 символов. Для нового набора не добавляй id ни вопросам, ни ответам. Реальные данные помечай isDemo:false, вымышленные учебные данные — isDemo:true. Максимальный размер JSON в UTF-8 — 3 МиБ; если не помещается, разбей на несколько полных наборов вопросов без потери групп.
После согласования выдай только валидный JSON без Markdown и пояснений. Ниже — исключительно образец структуры с вымышленными данными; не используй его ответы вместо моей выгрузки:

${JSON.stringify(EXAMPLE_PACK, null, 2)}`;

type CheckedPack = {
  pack: QuestionPack;
  existingIds: Set<string>;
  warnings: string[];
};
type ImportMode = "update" | "copy";
type SavePayload = QuestionPack & { replaceIds: string[] };

function importWarnings(pack: QuestionPack) {
  const warnings: string[] = [];
  const prompts = new Map<string, number>();
  pack.questions.forEach((question, index) => {
    const label = `Вопрос ${index + 1}`;
    if (!question.source.trim())
      warnings.push(
        `${label}: источник не указан. Он не появится в итогах игры.`,
      );
    if (question.respondentCount === null)
      warnings.push(
        `${label}: число опрошенных неизвестно. Не подменяйте его суммой очков.`,
      );
    const zeroCount = question.answers.filter(
      (answer) => answer.points === 0,
    ).length;
    if (zeroCount)
      warnings.push(
        `${label}: ответов с нулевыми очками — ${zeroCount}. Они будут сохранены, но не увеличат счёт.`,
      );
    const ranked = rankedAnswers(question.answers);
    if (
      ranked.length > GAME_ANSWER_LIMIT &&
      ranked[GAME_ANSWER_LIMIT - 1].points === ranked[GAME_ANSWER_LIMIT].points
    )
      warnings.push(
        `${label}: у 6-го и 7-го вариантов одинаковые очки (${ranked[GAME_ANSWER_LIMIT].points}). На табло попадёт тот, который раньше в списке answers. Проверьте выбор; после импорта порядок можно изменить в библиотеке. Все варианты останутся в статистике.`,
      );
    const key = question.prompt.trim().toLocaleLowerCase("ru");
    const previous = prompts.get(key);
    if (previous !== undefined)
      warnings.push(
        `${label}: формулировка повторяет вопрос ${previous + 1} в этом наборе.`,
      );
    else prompts.set(key, index);
  });
  return warnings;
}

/** Stable IDs make a retry of the same save update its rows rather than add copies. */
function savingPack(pack: QuestionPack, mode: ImportMode): QuestionPack {
  return {
    ...pack,
    questions: pack.questions.map((question) => ({
      ...question,
      id:
        mode === "copy"
          ? crypto.randomUUID()
          : (question.id ?? crypto.randomUUID()),
      answers: question.answers.map((answer) => ({
        ...answer,
        id:
          mode === "copy"
            ? crypto.randomUUID()
            : (answer.id ?? crypto.randomUUID()),
      })),
    })),
  };
}

export default function QuestionImport() {
  const [text, setText] = useState("");
  const [filename, setFilename] = useState("");
  const [packName, setPackName] = useState("");
  const [issues, setIssues] = useState<QuestionImportIssue[]>([]);
  const [checked, setChecked] = useState<CheckedPack | null>(null);
  const [mode, setMode] = useState<ImportMode>("update");
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [reading, setReading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [copyNotice, setCopyNotice] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const operation = useRef(0);
  const saveLock = useRef(false);
  const preparedSave = useRef<SavePayload | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      operation.current += 1;
      controller.current?.abort();
    },
    [],
  );

  const byteCount = useMemo(
    () => new TextEncoder().encode(text).byteLength,
    [text],
  );
  const trimmedPackName = packName.trim();
  const packNameIssue =
    packName && !trimmedPackName
      ? "Название не может состоять только из пробелов. Введите название или оставьте поле пустым."
      : trimmedPackName.length > 100
        ? "Название набора должно быть не длиннее 100 символов."
        : "";
  const suggestedPackName = filename.replace(/\.json$/i, "").trim().slice(0, 100).trim();
  const previewPacks = useMemo(() => {
    const packs = new Map<string, number>();
    checked?.pack.questions.forEach((question) => {
      packs.set(question.pack, (packs.get(question.pack) ?? 0) + 1);
    });
    return [...packs];
  }, [checked]);
  const matching =
    checked?.pack.questions.filter(
      (question) => question.id && checked.existingIds.has(question.id),
    ).length ?? 0;
  const updating = mode === "update" ? matching : 0;
  const total = checked?.pack.questions.length ?? 0;
  const busy = reading || checking || saving;
  const canSave = checked !== null && !busy && (!updating || replaceConfirmed);

  const invalidate = () => {
    operation.current += 1;
    controller.current?.abort();
    setReading(false);
    setChecking(false);
    setChecked(null);
    setIssues([]);
    setError("");
    setSavedCount(null);
    setReplaceConfirmed(false);
    setMode("update");
    preparedSave.current = null;
  };

  const updatePackName = (value: string) => {
    if (saveLock.current) return;
    invalidate();
    setPackName(value);
  };

  const readFile = async (file: File) => {
    if (saveLock.current) return;
    invalidate();
    const current = operation.current;
    setFilename("");
    setReading(true);
    try {
      if (!file.name.toLocaleLowerCase("ru").endsWith(".json"))
        throw new Error(
          "Выберите файл с расширением .json. Выгрузку анкеты сначала подготовьте через ИИ.",
        );
      if (file.size > IMPORT_MAX_BYTES)
        throw new Error("Файл слишком большой. Максимальный размер — 3 МБ.");
      const nextText = await file.text();
      if (operation.current !== current) return;
      setText(nextText);
      setFilename(file.name);
    } catch (cause) {
      if (operation.current === current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Не удалось прочитать файл. Попробуйте выбрать его ещё раз.",
        );
    } finally {
      if (operation.current === current) setReading(false);
    }
  };

  const check = async () => {
    if (busy || saveLock.current) return;
    invalidate();
    const current = operation.current;
    if (packNameIssue) {
      setIssues([{ path: "Название набора", message: packNameIssue }]);
      return;
    }
    const parsed = parseQuestionPack(text);
    if (!parsed.success) {
      setIssues(parsed.issues);
      return;
    }
    const pack: QuestionPack = trimmedPackName
      ? {
          ...parsed.data,
          questions: parsed.data.questions.map((question) => ({
            ...question,
            pack: trimmedPackName,
          })),
        }
      : parsed.data;
    setChecking(true);
    const request = new AbortController();
    controller.current = request;
    try {
      const library = await api<Question[]>("/questions", {
        signal: request.signal,
      });
      if (operation.current !== current) return;
      setChecked({
        pack,
        existingIds: new Set(
          library.map((question) => question.id.toLowerCase()),
        ),
        warnings: importWarnings(pack),
      });
    } catch (cause) {
      if (operation.current === current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Не удалось сравнить вопросы с библиотекой. Повторите проверку.",
        );
    } finally {
      if (operation.current === current) setChecking(false);
    }
  };

  const save = async () => {
    if (!checked || !canSave || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setError("");
    const current = operation.current;
    try {
      const payload = preparedSave.current ?? {
        ...savingPack(checked.pack, mode),
        replaceIds:
          mode === "update" && replaceConfirmed
            ? checked.pack.questions
                .filter(
                  (question) =>
                    question.id && checked.existingIds.has(question.id),
                )
                .map((question) => question.id!)
            : [],
      };
      preparedSave.current = payload;
      const body = JSON.stringify(payload);
      if (new TextEncoder().encode(body).byteLength > IMPORT_MAX_BYTES)
        throw new Error(
          "После подготовки к сохранению JSON превышает 3 МБ. Разделите набор на несколько файлов и проверьте каждый отдельно.",
        );
      const result = await api<{ count: number }>("/questions/import", {
        method: "POST",
        body,
      });
      if (operation.current !== current) return;
      setSavedCount(result.count);
      setText("");
      setFilename("");
      setPackName("");
      setChecked(null);
      setReplaceConfirmed(false);
      preparedSave.current = null;
    } catch (cause) {
      if (operation.current === current) {
        if (cause instanceof ApiError && cause.status === 409) {
          setChecked(null);
          setReplaceConfirmed(false);
          preparedSave.current = null;
        }
        setError(
          cause instanceof Error
            ? cause.message
            : "Не удалось сохранить вопросы. Повторите сохранение.",
        );
      }
    } finally {
      saveLock.current = false;
      if (operation.current === current) setSaving(false);
    }
  };

  const downloadExample = () => {
    const url = URL.createObjectURL(
      new Blob([`${JSON.stringify(EXAMPLE_PACK, null, 2)}\n`], {
        type: "application/json;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "100k1-example.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(AI_PROMPT);
      setCopyNotice(
        "Запрос скопирован. Вставьте его в ИИ вместе с выгрузкой опроса.",
      );
    } catch {
      setShowPrompt(true);
      setCopyNotice(
        "Автоматическое копирование недоступно. Выделите и скопируйте запрос ниже.",
      );
    }
  };

  return (
    <div className="question-import">
      <Link className="back-link" to="/admin/questions">
        <ArrowLeft size={17} /> К библиотеке вопросов
      </Link>
      <header className="page-heading question-import-heading">
        <div>
          <p className="eyebrow">Из опроса — в игру</p>
          <h1>Импорт вопросов</h1>
          <p className="muted">
            Сохраните все ответы опроса: на табло попадёт ТОП 6, в статистику —
            каждый вариант.
          </p>
        </div>
        <FileJson
          className="question-import-heading-icon"
          size={40}
          aria-hidden="true"
        />
      </header>

      <ol className="question-import-steps" aria-label="Этапы импорта">
        <li
          className={!checked && savedCount === null ? "current" : "done"}
          aria-current={!checked && savedCount === null ? "step" : undefined}
        >
          <span>1</span> Загрузить JSON
        </li>
        <li
          className={checked ? "current" : savedCount !== null ? "done" : ""}
          aria-current={checked ? "step" : undefined}
        >
          <span>2</span> Проверить вопросы
        </li>
        <li
          className={savedCount !== null ? "done" : ""}
          aria-current={savedCount !== null ? "step" : undefined}
        >
          <span>{savedCount !== null ? <Check size={16} /> : "3"}</span>{" "}
          Сохранить
        </li>
      </ol>

      <details className="question-import-help">
        <summary>
          <Sparkles size={19} />
          <span>Как подготовить опрос через ИИ</span>
        </summary>
        <div className="question-import-help-body">
          <p>
            Выгрузите результаты из Яндекс Анкет, передайте их своему ИИ и
            попросите собрать JSON по образцу. Затем вернитесь сюда, чтобы
            проверить готовые вопросы. Сырые анкеты эта страница не преобразует.
          </p>
          <p className="muted">
            Сверьте группировку ответов и числа с исходным опросом. Очки могут
            отличаться от числа людей; неизвестные сведения лучше оставить
            пустыми.
          </p>
          <p>
            Подпись ответа увидят гости, а исходные фразы из поля originals —
            только организатор. Проверьте шутки и спорные формулировки вручную:
            автоматической цензуры нет.
          </p>
          <div className="question-import-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={downloadExample}
            >
              <Download size={18} /> Скачать пример JSON
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => void copyPrompt()}
            >
              <Clipboard size={18} /> Скопировать запрос для ИИ
            </button>
          </div>
          <p className="form-hint">
            Пример содержит вымышленные данные с пометкой «Демо».
          </p>
          {copyNotice && (
            <p role="status" className="question-import-copy-notice">
              {copyNotice}
            </p>
          )}
          {showPrompt && (
            <label className="field question-import-prompt">
              <span id="import-ai-prompt-label">Запрос для ИИ</span>
              <textarea
                aria-labelledby="import-ai-prompt-label"
                readOnly
                value={AI_PROMPT}
                rows={12}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
          )}
        </div>
      </details>

      {savedCount !== null && (
        <div className="question-import-success" role="status">
          <CheckCircle2 size={26} aria-hidden="true" />
          <div>
            <h2>Сохранено вопросов: {savedCount}.</h2>
            <p>
              Набор готов. В библиотеке можно изменить подписи для гостей и
              порядок равных ответов. Проверьте их перед созданием игры.
            </p>
            <Link className="button button-primary" to="/admin/questions">
              Открыть библиотеку <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      )}

      <section aria-labelledby="import-source-heading">
        <CollapsibleCard
          className="question-import-input"
          defaultOpen
          header={
            <div className="question-import-section-heading">
              <div>
                <h2 id="import-source-heading">1. Добавьте готовый набор</h2>
                <p className="muted">
                  Файл .json до 3 МБ или текст, который подготовил ИИ.
                </p>
              </div>
              <FileJson size={26} className="question-import-valid-icon" aria-hidden="true" />
            </div>
          }
        >
          <div className="question-import-file-toolbar">
            <button
              type="button"
              className="button button-secondary"
              disabled={saving}
              onClick={() => fileInput.current?.click()}
            >
              <FileUp size={18} /> Выбрать JSON-файл
            </button>
          </div>
          <input
            ref={fileInput}
            className="question-import-file"
            type="file"
            accept=".json,application/json"
            aria-label="JSON-файл с вопросами"
            disabled={saving}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void readFile(file);
            }}
          />
          <label className="field question-import-editor">
            <span id="import-json-label">Готовый JSON</span>
            <textarea
              aria-labelledby="import-json-label"
              ref={editor}
              value={text}
              rows={10}
              spellCheck={false}
              disabled={saving}
              placeholder={
                '{\n  "format": "ctokodnomy-questions-v1",\n  "questions": [...]\n}'
              }
              aria-describedby="import-editor-hint"
              onChange={(event) => {
                if (saveLock.current) return;
                invalidate();
                setFilename("");
                setText(event.target.value);
              }}
            />
          </label>
          <div className="question-import-pack-name">
            <label className="field">
              <span>Название набора</span>
              <input
                type="text"
                value={packName}
                maxLength={100}
                disabled={saving || reading}
                placeholder="Например, День социолога"
                aria-describedby={`import-pack-name-hint${packNameIssue ? " import-pack-name-error" : ""}`}
                aria-invalid={Boolean(packNameIssue)}
                onChange={(event) => updatePackName(event.target.value)}
              />
            </label>
            <p className="form-hint" id="import-pack-name-hint">
              Один набор для всех вопросов этого импорта; пустое поле сохраняет
              наборы из файла. Потом название можно изменить в библиотеке.
            </p>
            {packNameIssue && (
              <p className="question-import-pack-name-error" id="import-pack-name-error" role="alert">
                {packNameIssue}
              </p>
            )}
            {suggestedPackName && (
              <button
                type="button"
                className="button button-secondary question-import-filename-button"
                disabled={saving || reading}
                onClick={() => updatePackName(suggestedPackName)}
              >
                Использовать имя файла: {suggestedPackName}
              </button>
            )}
          </div>
          <div className="question-import-editor-footer">
            <p className="form-hint" id="import-editor-hint">
              {reading
                ? "Читаем файл…"
                : filename
                  ? `Файл: ${filename}`
                  : "Вставьте весь JSON, включая внешние фигурные скобки."}
              <span
                className={
                  byteCount > IMPORT_MAX_BYTES ? "question-import-size-error" : ""
                }
              >
                {(byteCount / 1024).toLocaleString("ru", {
                  maximumFractionDigits: 1,
                })}{" "}
                КБ / 3 МБ
              </span>
            </p>
            <button
              type="button"
              className="button button-primary"
              disabled={busy}
              onClick={() => void check()}
            >
              <CheckCircle2 size={18} />{" "}
              {checking ? "Проверяем…" : "Проверить вопросы"}
            </button>
          </div>
        </CollapsibleCard>
      </section>

      {issues.length > 0 && (
        <section className="question-import-errors" role="alert">
          <div className="question-import-alert-heading">
            <AlertTriangle size={22} />
            <h2>Исправьте ошибки</h2>
          </div>
          <p>Вопросы ещё не сохранены. Исправьте отмеченные поля или JSON и повторите проверку.</p>
          <ul>
            {issues.map((issue, index) => (
              <li key={`${issue.path}-${index}`}>
                <strong>{issue.path}:</strong> {issue.message}
              </li>
            ))}
          </ul>
        </section>
      )}
      {error && (
        <div className="question-import-request-error" role="alert">
          <AlertTriangle size={20} aria-hidden="true" />
          <p>{error}</p>
        </div>
      )}

      {checked && (
        <section aria-label="Предпросмотр вопросов">
          <CollapsibleCard
            className="question-import-preview"
            defaultOpen
            header={
              <div className="question-import-section-heading">
                <div>
                  <p className="eyebrow">JSON прошёл проверку</p>
                  <h2>2. Просмотрите вопросы</h2>
                  <p className="muted">
                    Проверьте подписи для гостей, ТОП 6 и полный список. Исходные
                    фразы ниже видны только организатору.
                  </p>
                </div>
                <CheckCircle2
                  className="question-import-valid-icon"
                  size={32}
                  aria-hidden="true"
                />
              </div>
            }
          >
            <div
              className="question-import-counts"
              aria-label="Результат проверки"
            >
              <span>
                Всего: <strong>{total}</strong>
              </span>
              <span>
                Новых: <strong>{total - updating}</strong>
              </span>
              <span>
                Обновляемых: <strong>{updating}</strong>
              </span>
            </div>
            <div className="question-import-pack-preview">
              <h3>Наборы после импорта</h3>
              <ul>
                {previewPacks.map(([name, count]) => (
                  <li key={name}>
                    <strong>{name || "Без набора"}</strong>
                    <span>Вопросов: {count}</span>
                  </li>
                ))}
              </ul>
              <p className="form-hint">
                Именованный набор можно целиком выбрать при настройке игры.
              </p>
            </div>
            {matching > 0 && (
              <fieldset className="question-import-mode" disabled={saving}>
                <legend>
                  В библиотеке уже есть совпадающие вопросы: {matching}
                </legend>
                <p className="form-hint">
                  Совпадение определяется по идентификатору из экспорта, а не по
                  тексту вопроса.
                </p>
                <label>
                  <input
                    type="radio"
                    name="question-import-mode"
                    aria-label="Обновить совпадающие"
                    value="update"
                    checked={mode === "update"}
                    onChange={() => {
                      setMode("update");
                      setReplaceConfirmed(false);
                      preparedSave.current = null;
                    }}
                  />
                  <span>
                    <strong>Обновить совпадающие</strong>
                    <small>Заменить содержимое этих вопросов в библиотеке.</small>
                  </span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="question-import-mode"
                    aria-label="Добавить все как новые"
                    value="copy"
                    checked={mode === "copy"}
                    onChange={() => {
                      setMode("copy");
                      setReplaceConfirmed(false);
                      preparedSave.current = null;
                    }}
                  />
                  <span>
                    <strong>Добавить все как новые</strong>
                    <small>
                      Создать копии вопросов. Для отдельного набора задайте
                      другое название перед проверкой.
                    </small>
                  </span>
                </label>
              </fieldset>
            )}
            {checked.warnings.length > 0 && (
              <details className="question-import-warnings">
                <summary>
                  <AlertTriangle size={19} />
                  <span>Обратите внимание: {checked.warnings.length}</span>
                </summary>
                <p>
                  Это не мешает сохранению. Проверьте, что данные соответствуют
                  вашему замыслу.
                </p>
                <ul>
                  {checked.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </details>
            )}
            <div className="question-import-question-list">
              {checked.pack.questions.map((question, index) => {
                const isUpdate =
                  mode === "update" &&
                  Boolean(question.id && checked.existingIds.has(question.id));
                const ranked = rankedAnswers(question.answers);
                const board = boardAnswers(question.answers);
                const allPoints = question.answers.reduce(
                  (sum, answer) => sum + answer.points,
                  0,
                );
                const boardPoints = board.reduce(
                  (sum, answer) => sum + answer.points,
                  0,
                );
                return (
                  <details
                    className="question-import-question"
                    open={total <= 3 ? true : undefined}
                    key={question.id ?? index}
                  >
                    <summary>
                      <span className="question-import-question-number">
                        {index + 1}
                      </span>
                      <span className="question-import-question-title">
                        <strong>{question.prompt}</strong>
                        <small>
                          Табло: {board.length} · Все варианты: {ranked.length}
                          {question.isDemo ? " · Демо" : ""}
                        </small>
                      </span>
                      <span
                        className={`question-import-kind${isUpdate ? " updating" : ""}`}
                      >
                        {isUpdate ? "Обновление" : "Новый"}
                      </span>
                    </summary>
                    <div className="question-import-question-body">
                      <div className="question-import-answer-totals">
                        <span>Сумма очков на табло: <strong>{boardPoints}</strong></span>
                        <span>Сумма очков всего опроса: <strong>{allPoints}</strong></span>
                      </div>
                      <ol className="question-import-answers">
                        {ranked.map((answer, answerIndex) => (
                          <li key={answer.id ?? answerIndex}>
                            <div>
                              <span className={`question-import-answer-scope${answerIndex < GAME_ANSWER_LIMIT ? " on-board" : ""}`}>
                                {answerIndex < GAME_ANSWER_LIMIT
                                  ? `ТОП 6 · табло № ${answerIndex + 1}`
                                  : "Статистика"}
                              </span>
                              <strong>{answer.text}</strong>
                              {answer.aliases.length > 0 && (
                                <small>
                                  Синонимы: {answer.aliases.join("; ")}
                                </small>
                              )}
                              {answer.originals && answer.originals.length > 0 && (
                                <details className="question-import-originals">
                                  <summary>Исходные фразы · только организатору ({answer.originals.length})</summary>
                                  <ul>
                                    {answer.originals.map((original, originalIndex) => (
                                      <li key={originalIndex}>{original}</li>
                                    ))}
                                  </ul>
                                </details>
                              )}
                            </div>
                            <span>
                              {answer.points}
                              <small>очков</small>
                            </span>
                          </li>
                        ))}
                      </ol>
                      <dl className="question-import-metadata">
                        <div>
                          <dt>Источник</dt>
                          <dd>{question.source || "Не указан"}</dd>
                        </div>
                        <div>
                          <dt>Дата опроса</dt>
                          <dd>{question.surveyDate || "Неизвестна"}</dd>
                        </div>
                        <div>
                          <dt>Опрошено</dt>
                          <dd>
                            {question.respondentCount?.toLocaleString("ru") ??
                              "Неизвестно"}
                          </dd>
                        </div>
                        <div>
                          <dt>Набор</dt>
                          <dd>{question.pack || "Без набора"}</dd>
                        </div>
                        <div>
                          <dt>Данные</dt>
                          <dd>
                            {question.isDemo
                              ? "Учебные, вымышленные"
                              : "Без пометки «Демо»"}
                          </dd>
                        </div>
                        {question.notes && (
                          <div className="question-import-notes">
                            <dt>Заметки ведущему</dt>
                            <dd>{question.notes}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  </details>
                );
              })}
            </div>
          </CollapsibleCard>
        </section>
      )}

      <section aria-labelledby="import-save-heading">
        <CollapsibleCard
          className="question-import-save"
          defaultOpen
          header={<h2 id="import-save-heading">3. Сохраните в библиотеку</h2>}
        >
          <div>
            <p className="muted">
              Снимки созданных игр не изменятся. Новый набор можно выбрать при
              создании следующей игры.
            </p>
            {checked && updating > 0 && (
              <label className="question-import-confirm">
                <input
                  type="checkbox"
                  aria-label="Заменить совпадающие вопросы в библиотеке"
                  checked={replaceConfirmed}
                  disabled={saving}
                  onChange={(event) => setReplaceConfirmed(event.target.checked)}
                />
                <span>
                  Заменить совпадающие вопросы в библиотеке
                  <strong>
                    Будет заменено: {updating}. Экспорт библиотеки позволит
                    заранее сохранить копию.
                  </strong>
                </span>
              </label>
            )}
            {!checked && savedCount === null && (
              <p className="form-hint">Сначала загрузите и проверьте вопросы.</p>
            )}
          </div>
          <button
            type="button"
            className="button button-primary"
            disabled={!canSave}
            onClick={() => void save()}
          >
            <Check size={19} /> {saving ? "Сохраняем…" : "Сохранить вопросы"}
          </button>
        </CollapsibleCard>
      </section>
    </div>
  );
}
