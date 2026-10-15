import { describe, expect, test } from "vitest";
import {
  IMPORT_MAX_BYTES,
  parseQuestionPack,
  questionPackSchema,
  questionSchema,
} from "../shared/questionImport";

const question = () => ({
  prompt: "  Что помогает команде?  ",
  answers: [{ text: "  Общение  ", points: 60 }],
});
const pack = (questions: unknown[] = [question()]) => ({
  format: "ctokodnomy-questions-v1",
  questions,
});
const questionId = "aabbccdd-1234-4123-8123-123456789abc";
const answerId = "bbbbcccc-1234-4123-8123-123456789abc";

describe("question import uses one browser/server contract", () => {
  test("accepts BOM and whitespace, trims game text, and fills optional metadata", () => {
    const result = parseQuestionPack(` \n\uFEFF${JSON.stringify(pack())}\r\n `);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected valid question pack");
    expect(result.data.questions).toEqual([{
      prompt: "Что помогает команде?",
      answers: [{ text: "Общение", points: 60, aliases: [] }],
      source: "",
      surveyDate: "",
      respondentCount: null,
      notes: "",
      isDemo: false,
      pack: "",
    }]);
  });

  test("canonicalizes UUIDs without requiring them and retains survey provenance", () => {
    const input = {
      ...question(),
      id: questionId.toUpperCase(),
      answers: [{
        id: answerId.toUpperCase(),
        text: "Ответ",
        points: 0,
        aliases: ["  Вариант  "],
      }],
      source: "Выгрузка анкеты",
      surveyDate: "2026-10-15",
      respondentCount: 120,
      notes: "Несколько ответов от одного человека",
      isDemo: true,
      pack: "Пример",
    };
    const parsed = questionPackSchema.parse(pack([input]));
    expect(parsed.questions[0]).toEqual({
      ...input,
      id: questionId,
      prompt: "Что помогает команде?",
      answers: [{ id: answerId, text: "Ответ", points: 0, aliases: ["Вариант"] }],
    });
    expect(questionPackSchema.safeParse(pack([question(), question()])).success).toBe(true);
  });

  test("rejects malformed JSON, Markdown fences, and missing format instead of repairing them", () => {
    for (const source of [
      '{"format":"ctokodnomy-questions-v1","questions":[],}',
      `\`\`\`json\n${JSON.stringify(pack())}\n\`\`\``,
      '{"format":',
    ]) {
      expect(parseQuestionPack(source)).toEqual({
        success: false,
        issues: [{
          path: "Файл",
          message: "Не удалось прочитать JSON. Проверьте кавычки, запятые и скобки.",
        }],
      });
    }
    expect(parseQuestionPack(" \n\uFEFF ")).toEqual({
      success: false,
      issues: [{ path: "Файл", message: "Вставьте JSON или выберите файл" }],
    });
    expect(parseQuestionPack(JSON.stringify({ questions: [question()] }))).toEqual({
      success: false,
      issues: [{ path: "Формат", message: "Формат файла должен быть «ctokodnomy-questions-v1»" }],
    });
  });

  test("limits UTF-8 bytes rather than characters, including surrounding whitespace", () => {
    const json = JSON.stringify(pack());
    const jsonBytes = new TextEncoder().encode(json).byteLength;
    const atLimit = json + " ".repeat(IMPORT_MAX_BYTES - jsonBytes);
    expect(parseQuestionPack(atLimit).success).toBe(true);
    const oversized = json + "я".repeat(Math.ceil((IMPORT_MAX_BYTES - jsonBytes) / 2) + 1);
    expect(oversized.length).toBeLessThan(IMPORT_MAX_BYTES);
    expect(parseQuestionPack(oversized)).toEqual({
      success: false,
      issues: [{ path: "Файл", message: "Размер JSON не должен превышать 3 МБ" }],
    });
  });

  test("explains the exact question, answer, and invalid field in Russian", () => {
    const result = parseQuestionPack(JSON.stringify(pack([
      question(),
      { ...question(), answers: [{ text: "Ответ", points: -1 }] },
    ])));
    expect(result).toEqual({
      success: false,
      issues: [{
        path: "Вопрос 2 → ответ 1 → очки",
        message: "Очки не могут быть отрицательными",
      }],
    });
    const aliases = parseQuestionPack(JSON.stringify(pack([{
      ...question(), answers: [{ text: "Ответ", points: 1, aliases: [""] }],
    }])));
    expect(aliases).toEqual({
      success: false,
      issues: [{
        path: "Вопрос 1 → ответ 1 → синоним 1",
        message: "Синоним не должен быть пустым",
      }],
    });
  });

  test("rejects repeated question IDs regardless of letter case", () => {
    for (const duplicate of [questionId, questionId.toUpperCase()]) {
      expect(parseQuestionPack(JSON.stringify(pack([
        { ...question(), id: questionId },
        { ...question(), id: duplicate },
      ])))).toEqual({
        success: false,
        issues: [{
          path: "Вопрос 2 → идентификатор",
          message: "Этот идентификатор уже используется в вопросе 1",
        }],
      });
    }
  });

  test("rejects repeated answer IDs and trimmed case-insensitive texts", () => {
    const result = parseQuestionPack(JSON.stringify(pack([{
      ...question(),
      answers: [
        { id: answerId, text: "Общение", points: 10 },
        { id: answerId.toUpperCase(), text: "  ОБЩЕНИЕ  ", points: 20 },
      ],
    }])));
    expect(result).toEqual({
      success: false,
      issues: [
        {
          path: "Вопрос 1 → ответ 2 → идентификатор",
          message: "Идентификаторы ответов должны отличаться",
        },
        {
          path: "Вопрос 1 → ответ 2 → текст",
          message: "Ответы должны отличаться",
        },
      ],
    });
  });

  test("preserves question limits and refuses an invalid pack in full", () => {
    const invalidQuestions = [
      { ...question(), answers: [] },
      { ...question(), answers: [null] },
      { ...question(), answers: Array.from({ length: 501 }, (_, i) => ({ text: `Ответ ${i}`, points: 1 })) },
      { ...question(), answers: [{ text: "Ответ", points: 1.5 }] },
      { ...question(), answers: [{ text: "Ответ", points: 1001 }] },
      { ...question(), respondentCount: 0 },
      { ...question(), respondentCount: 1_000_001 },
      { ...question(), id: "не UUID" },
    ];
    for (const invalid of invalidQuestions) {
      expect(questionSchema.safeParse(invalid).success).toBe(false);
      const result = parseQuestionPack(JSON.stringify(pack([question(), invalid])));
      expect(result.success).toBe(false);
      expect(result).not.toHaveProperty("data");
    }
    expect(questionPackSchema.safeParse(pack([])).success).toBe(false);
    expect(questionPackSchema.safeParse(pack(Array.from({ length: 501 }, question))).success).toBe(false);
  });

  test("imports all survey variants and retains private originals without changing them", () => {
    const input = {
      ...question(),
      answers: Array.from({ length: 500 }, (_, index) => ({
        text: `Вариант ${index + 1}`,
        points: index % 17,
        aliases: ["Синоним"],
        originals: [`  Дословная формулировка №${index + 1}  `],
      })),
    };
    const parsed = questionPackSchema.parse(pack([input]));
    expect(parsed.questions[0]!.answers).toHaveLength(500);
    expect(parsed.questions[0]!.answers[0]!.originals).toEqual(["  Дословная формулировка №1  "]);
    expect(parseQuestionPack(JSON.stringify(parsed))).toEqual({ success: true, data: parsed });
    expect(questionSchema.parse(question()).answers[0]).not.toHaveProperty("originals");
  });

  test("rejects invalid private originals and explains the source phrase location", () => {
    for (const originals of ["Строка вместо списка", [" "], [null], ["я".repeat(501)], Array.from({ length: 101 }, () => "Фраза")]) {
      expect(questionSchema.safeParse({
        ...question(), answers: [{ text: "Ответ", points: 1, originals }],
      }).success).toBe(false);
    }
    expect(parseQuestionPack(JSON.stringify(pack([{
      ...question(), answers: [{ text: "Ответ", points: 1, originals: [""] }],
    }])))).toEqual({
      success: false,
      issues: [{
        path: "Вопрос 1 → ответ 1 → исходная формулировка 1",
        message: "Исходная формулировка не должна быть пустой",
      }],
    });
  });
});
