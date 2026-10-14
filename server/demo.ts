import { randomUUID } from "node:crypto";
import type { Question } from "../shared/types.js";

// Server-only rehearsal data: hidden answers must never be shipped in a browser bundle.
const examples: { prompt: string; answers: [string, number][] }[] = [
  {
    prompt: "Что люди чаще всего делают в общественном транспорте?",
    answers: [
      ["Смотрят в телефон", 34],
      ["Слушают музыку", 25],
      ["Смотрят в окно", 18],
      ["Читают", 11],
      ["Разговаривают", 7],
      ["Спят", 5],
    ],
  },
  {
    prompt: "Где люди знакомятся с новыми друзьями?",
    answers: [
      ["На учёбе", 32],
      ["На работе", 26],
      ["В интернете", 20],
      ["На мероприятиях", 12],
      ["Через общих друзей", 7],
      ["В поездках", 3],
    ],
  },
  {
    prompt: "Что помогает человеку почувствовать себя частью команды?",
    answers: [
      ["Общая цель", 36],
      ["Поддержка", 24],
      ["Общение", 17],
      ["Уважение", 11],
      ["Совместные победы", 8],
      ["Традиции", 4],
    ],
  },
];
export function createDemoQuestions(): Question[] {
  return examples.map((example) => ({
    id: randomUUID(),
    prompt: example.prompt,
    answers: example.answers.map(([text, points]) => ({
      id: randomUUID(),
      text,
      points,
      aliases: [],
    })),
    source: "Учебный пример. Реальный опрос не проводился.",
    surveyDate: "",
    respondentCount: null,
    notes: "Только для репетиции: ответы и очки вымышлены.",
    isDemo: true,
    pack: "Репетиция · демо",
  }));
}
