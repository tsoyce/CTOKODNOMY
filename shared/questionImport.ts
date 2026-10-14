import { z } from "zod";

/** The same UTF-8 limit applies to a pasted file and to the API request body. */
export const IMPORT_MAX_BYTES = 3 * 1024 * 1024;

const importId = z
  .uuid({ error: "Используйте корректный UUID" })
  .transform((value) => value.toLowerCase());
const answerSchema = z.object({
  id: importId.optional(),
  text: z
    .string({ error: "Введите текст ответа" })
    .trim()
    .min(1, "Введите текст ответа")
    .max(200, "Текст ответа должен быть не длиннее 200 символов"),
  points: z
    .number({ error: "Введите очки целым числом" })
    .int("Введите очки целым числом")
    .min(0, "Очки не могут быть отрицательными")
    .max(1000, "У ответа может быть не больше 1000 очков"),
  aliases: z
    .array(
      z
        .string({ error: "Синоним должен быть текстом" })
        .trim()
        .min(1, "Синоним не должен быть пустым")
        .max(200, "Синоним должен быть не длиннее 200 символов"),
      { error: "Укажите синонимы списком" },
    )
    .max(30, "У ответа может быть не больше 30 синонимов")
    .default([]),
}, { error: "Ответ должен быть объектом с текстом и очками" });

/** Input shared by manual editing, import preview, and all question API writes. */
export const questionSchema = z
  .object({
    id: importId.optional(),
    prompt: z
      .string({ error: "Введите текст вопроса" })
      .trim()
      .min(1, "Введите текст вопроса")
      .max(500, "Текст вопроса должен быть не длиннее 500 символов"),
    answers: z
      .array(answerSchema, { error: "Укажите ответы списком" })
      .min(1, "Добавьте хотя бы один ответ")
      .max(12, "У вопроса может быть не больше 12 ответов"),
    source: z
      .string({ error: "Источник должен быть текстом" })
      .max(1000, "Источник должен быть не длиннее 1000 символов")
      .default(""),
    surveyDate: z
      .string({ error: "Дата опроса должна быть текстом" })
      .max(40, "Дата опроса должна быть не длиннее 40 символов")
      .default(""),
    respondentCount: z
      .number({ error: "Укажите число участников опроса или null" })
      .int("Число участников опроса должно быть целым")
      .min(1, "Число участников опроса должно быть больше нуля")
      .max(1_000_000, "Число участников опроса не должно превышать 1 000 000")
      .nullable()
      .default(null),
    notes: z
      .string({ error: "Заметки должны быть текстом" })
      .max(4000, "Заметки должны быть не длиннее 4000 символов")
      .default(""),
    isDemo: z
      .boolean({ error: "Укажите true для демонстрационного вопроса или false" })
      .default(false),
    pack: z
      .string({ error: "Название набора должно быть текстом" })
      .max(100, "Название набора должно быть не длиннее 100 символов")
      .default(""),
  }, { error: "Вопрос должен быть объектом" })
  .superRefine((question, context) => {
    const ids = new Set<string>();
    const texts = new Set<string>();
    question.answers.forEach((answer, index) => {
      if (answer.id && ids.has(answer.id))
        context.addIssue({
          code: "custom",
          message: "Идентификаторы ответов должны отличаться",
          path: ["answers", index, "id"],
        });
      if (answer.id) ids.add(answer.id);
      const text = answer.text.toLocaleLowerCase("ru");
      if (texts.has(text))
        context.addIssue({
          code: "custom",
          message: "Ответы должны отличаться",
          path: ["answers", index, "text"],
        });
      texts.add(text);
    });
  });

export const questionPackSchema = z
  .object({
    format: z.literal("ctokodnomy-questions-v1", {
      error: "Формат файла должен быть «ctokodnomy-questions-v1»",
    }),
    questions: z
      .array(questionSchema, { error: "Укажите вопросы списком" })
      .min(1, "Добавьте хотя бы один вопрос")
      .max(500, "В одном файле может быть не больше 500 вопросов"),
  }, { error: "В корне JSON должен быть объект с полями format и questions" })
  .superRefine((pack, context) => {
    const ids = new Map<string, number>();
    pack.questions.forEach((question, index) => {
      if (!question.id) return;
      const previousIndex = ids.get(question.id);
      if (previousIndex !== undefined)
        context.addIssue({
          code: "custom",
          message: `Этот идентификатор уже используется в вопросе ${previousIndex + 1}`,
          path: ["questions", index, "id"],
        });
      else ids.set(question.id, index);
    });
  });

export type QuestionPack = z.output<typeof questionPackSchema>;
export interface QuestionImportIssue {
  path: string;
  message: string;
}

const fieldNames: Record<string, string> = {
  format: "формат",
  questions: "список вопросов",
  answers: "список ответов",
  aliases: "синонимы",
  id: "идентификатор",
  prompt: "текст вопроса",
  text: "текст",
  points: "очки",
  source: "источник",
  surveyDate: "дата опроса",
  respondentCount: "число участников опроса",
  notes: "заметки",
  isDemo: "демонстрационный вопрос",
  pack: "название набора",
};

/** Keep paths readable in both the browser preview and API error messages. */
export function questionImportIssues(
  issues: readonly z.core.$ZodIssue[],
): QuestionImportIssue[] {
  return issues.map((issue) => {
    const parts: string[] = [];
    for (let index = 0; index < issue.path.length; index += 1) {
      const field = issue.path[index];
      const item = issue.path[index + 1];
      if (
        (field === "questions" || field === "answers" || field === "aliases") &&
        typeof item === "number"
      ) {
        const label = { questions: "вопрос", answers: "ответ", aliases: "синоним" }[field];
        parts.push(`${label} ${item + 1}`);
        index += 1;
      } else parts.push(fieldNames[String(field)] ?? String(field));
    }
    const path = parts.join(" → ") || "файл";
    return {
      path: path[0]!.toLocaleUpperCase("ru") + path.slice(1),
      message: issue.message,
    };
  });
}

export function parseQuestionPack(text: string):
  | { success: true; data: QuestionPack }
  | { success: false; issues: QuestionImportIssue[] } {
  if (new TextEncoder().encode(text).byteLength > IMPORT_MAX_BYTES)
    return {
      success: false,
      issues: [{ path: "Файл", message: "Размер JSON не должен превышать 3 МБ" }],
    };
  const source = text.trim(); // Includes the UTF-8 BOM when decoded as text.
  if (!source)
    return {
      success: false,
      issues: [{ path: "Файл", message: "Вставьте JSON или выберите файл" }],
    };
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return {
      success: false,
      issues: [{
        path: "Файл",
        message: "Не удалось прочитать JSON. Проверьте кавычки, запятые и скобки.",
      }],
    };
  }
  const parsed = questionPackSchema.safeParse(value);
  return parsed.success
    ? { success: true, data: parsed.data }
    : { success: false, issues: questionImportIssues(parsed.error.issues) };
}
