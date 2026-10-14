import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import {
  expect,
  test,
  type BrowserContext,
  type Locator,
} from "@playwright/test";
import { issueSetupToken } from "../server/db";
import { parseQuestionPack } from "../shared/questionImport";
import type { HostGame, Question } from "../shared/types";

const databaseUrl = process.env.DATABASE_URL_TEST;
const schema = process.env.E2E_DATABASE_SCHEMA;
if (
  !databaseUrl ||
  !decodeURIComponent(new URL(databaseUrl).pathname).endsWith("_test") ||
  !schema ||
  !/^e2e_[a-f0-9]{32}$/.test(schema)
) {
  throw new Error(
    "E2E tests must run through playwright.config.ts with a dedicated _test database and an isolated schema.",
  );
}
const pool = new pg.Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schema}`,
});
const PASSWORD = "x";

// Setting the native value and dispatching input still drives React's form.
// Unlike fill(value), failed Playwright action logs cannot include secret text.
async function fillSecret(input: Locator, value: string) {
  await expect(input).toBeVisible();
  await input.evaluate((element, secret) => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setter) throw new Error("Input unavailable");
    setter.call(element, secret);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

test.beforeEach(async () => {
  // This reset is confined to the random schema just created for this run. It
  // also makes a CI retry independent from a partly completed first attempt.
  await pool.query(
    "TRUNCATE game_commands,participant_sessions,participants,games,questions,admin_sessions,admins,setup_grants CASCADE",
  );
  await pool.query(
    "UPDATE app_settings SET initialized=false,brand='{}'::jsonb WHERE id=1",
  );
});
test.afterAll(async () => {
  await pool.end();
});

test("organizer checks a complete JSON pack before saving, explicitly updates matching questions or imports copies", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const importRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/questions/import"
    )
      importRequests.push(request.url());
  });

  const grant = await issueSetupToken(pool);
  await page.goto("/setup");
  await fillSecret(page.getByLabel("Код первого запуска"), grant);
  await page.getByLabel("Логин организатора").fill("organizer");
  await fillSecret(page.getByLabel(/^Пароль/), PASSWORD);
  await fillSecret(page.getByLabel("Повторите пароль"), PASSWORD);
  await page.getByRole("button", { name: "Далее: мероприятие" }).click();
  await page.getByRole("button", { name: "Проектор", exact: true }).click();
  await page
    .getByRole("button", { name: "Предпросмотр", exact: true })
    .click();
  await page.getByRole("button", { name: "Завершить настройку" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  const library = async (): Promise<Question[]> => {
    const response = await page.request.get("/api/questions");
    expect(response.ok()).toBe(true);
    return response.json();
  };
  await page.goto("/admin/questions");
  await page.getByRole("link", { name: "Импорт JSON", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/questions\/import$/);
  await expect(
    page.getByRole("heading", { name: "Импорт вопросов", exact: true }),
  ).toBeVisible();
  const jsonInput = page.getByLabel("Готовый JSON", { exact: true });
  const check = page.getByRole("button", {
    name: "Проверить вопросы",
    exact: true,
  });
  const save = page.getByRole("button", {
    name: "Сохранить вопросы",
    exact: true,
  });
  const preview = page.getByRole("region", {
    name: "Предпросмотр вопросов",
    exact: true,
  });
  const replaceConsent = page.getByRole("checkbox", {
    name: /^Заменить совпадающие вопросы в библиотеке/,
  });
  await expect(save).toBeDisabled();

  const surveyHelp = page.getByText("Как подготовить опрос через ИИ", {
    exact: true,
  });
  await surveyHelp.click();
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Скачать пример JSON", exact: true })
    .click();
  const download = await downloadEvent;
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const exampleText = await readFile(downloadPath!, "utf8");
  const checkedExample = parseQuestionPack(exampleText);
  expect(checkedExample.success).toBe(true);
  if (!checkedExample.success)
    throw new Error("The downloadable example is invalid");
  const example = checkedExample.data;
  expect(example.questions.length).toBeGreaterThan(0);
  for (const question of example.questions) {
    expect(question.prompt.trim()).not.toBe("");
    expect(question.isDemo).toBe(true);
    expect(question.answers.length).toBeGreaterThan(0);
    for (const answer of question.answers) {
      expect(answer.text.trim()).not.toBe("");
      expect(Number.isInteger(answer.points)).toBe(true);
      expect(answer.points).toBeGreaterThanOrEqual(0);
      expect(answer.points).toBeLessThanOrEqual(1000);
    }
  }
  await surveyHelp.click();

  await page
    .getByLabel("JSON-файл с вопросами", { exact: true })
    .setInputFiles({
      name: download.suggestedFilename(),
      mimeType: "application/json",
      buffer: Buffer.from(exampleText),
    });
  await expect(jsonInput).toHaveValue(exampleText);
  await check.click();
  await expect(preview).toBeVisible();
  await expect(preview).toContainText(example.questions[0]!.prompt);
  await expect(preview).toContainText(example.questions[0]!.answers[0]!.text);
  await expect(preview).toContainText(/Демо|вымышлен/);
  expect(importRequests).toHaveLength(0);
  expect(await library()).toEqual([]);

  await jsonInput.fill('{"format":');
  await expect(preview).toHaveCount(0);
  await expect(save).toBeDisabled();
  await check.click();
  await expect(
    page.getByRole("heading", { name: "Исправьте ошибки", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("JSON");
  await expect(preview).toHaveCount(0);
  await expect(save).toBeDisabled();
  expect(importRequests).toHaveLength(0);
  expect(await library()).toEqual([]);

  const importedQuestion = {
    prompt: "Что помогает отдохнуть после занятий?",
    answers: [
      { text: "Прогулка", points: 42, aliases: ["Погулять"] },
      { text: "Музыка", points: 17, aliases: [] },
    ],
    source: "Учебный опрос для проверки мастера",
    surveyDate: "2026-10-14",
    respondentCount: 59,
    notes: "Ответы и очки вымышлены для E2E.",
    isDemo: true,
    pack: "Проверка мастера",
  };
  const invalidPack = {
    format: "ctokodnomy-questions-v1",
    questions: [
      importedQuestion,
      {
        ...importedQuestion,
        prompt: "Этот вопрос содержит неверное число очков",
        answers: [{ text: "Неверный ответ", points: 1001 }],
      },
    ],
  };
  await jsonInput.fill(JSON.stringify(invalidPack));
  await check.click();
  await expect(page.getByRole("alert")).toContainText(/1000/);
  await expect(page.getByRole("alert")).toContainText(/2/);
  await expect(preview).toHaveCount(0);
  await expect(save).toBeDisabled();
  expect(importRequests).toHaveLength(0);
  expect(await library()).toEqual([]);

  const validPack = {
    format: "ctokodnomy-questions-v1",
    questions: [{
      ...importedQuestion,
      id: "fc551222-9756-4a93-ae90-7b3e6da02bfa",
    }],
  };
  await jsonInput.fill(JSON.stringify(validPack, null, 2));
  await check.click();
  await expect(preview).toBeVisible();
  await expect(preview).toContainText(importedQuestion.prompt);
  await expect(preview).toContainText("Прогулка");
  await expect(preview).toContainText("42");
  await expect(preview).toContainText("Музыка");
  await expect(preview).toContainText("17");
  await expect(preview).toContainText(importedQuestion.source);
  await expect(preview).toContainText(/Демо|вымышлен/);
  await expect(page.locator("body")).toContainText("Новых: 1");
  await expect(page.locator("body")).toContainText("Обновляемых: 0");
  await expect(save).toBeEnabled();
  // Checking and rendering the complete preview must never save to the server.
  expect(importRequests).toHaveLength(0);
  expect(await library()).toEqual([]);

  await mkdir(path.resolve("test-results"), { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: "test-results/import-preview-desktop.png",
    fullPage: true,
  });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await expect(save).toBeEnabled();
    await save.scrollIntoViewIfNeeded();
    const box = await save.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    if (width === 390)
      await page.screenshot({
        path: "test-results/import-preview-mobile.png",
        fullPage: true,
      });
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // Editing even a previously valid input invalidates its preview and save action.
  await jsonInput.fill(JSON.stringify({ ...validPack, questions: [] }));
  await expect(preview).toHaveCount(0);
  await expect(save).toBeDisabled();
  expect(importRequests).toHaveLength(0);
  await jsonInput.fill(JSON.stringify(validPack));
  await check.click();
  await expect(preview).toBeVisible();
  // Another tab can add a previously new UUID after this preview. Saving must
  // preserve that row until the organizer reviews and confirms the replacement.
  const concurrentPrompt = "Вопрос из соседней вкладки, который нельзя затереть";
  const concurrent = await page.request.post("/api/questions/import", {
    data: {
      ...validPack,
      questions: [{ ...validPack.questions[0]!, prompt: concurrentPrompt }],
    },
  });
  expect(concurrent.ok()).toBe(true);
  const conflictingImport = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/questions/import") &&
      response.request().method() === "POST",
  );
  await save.click();
  expect((await conflictingImport).status()).toBe(409);
  await expect(page.getByRole("alert")).toContainText("Библиотека изменилась");
  await expect(preview).toHaveCount(0);
  await expect(save).toBeDisabled();
  await expect(jsonInput).toHaveValue(JSON.stringify(validPack));
  expect((await library())[0]!.prompt).toBe(concurrentPrompt);
  expect(importRequests).toHaveLength(1);
  await check.click();
  await expect(preview).toBeVisible();
  await expect(page.locator("body")).toContainText("Обновляемых: 1");
  await expect(replaceConsent).not.toBeChecked();
  await expect(save).toBeDisabled();
  await replaceConsent.check();
  const firstImport = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/questions/import") &&
      response.request().method() === "POST",
  );
  await save.click();
  expect((await firstImport).ok()).toBe(true);
  await expect(page.getByRole("status")).toContainText(
    "Сохранено вопросов: 1.",
  );
  const saved = await library();
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject(importedQuestion);
  expect(importRequests).toHaveLength(2);

  const updatedQuestion = {
    ...saved[0]!,
    prompt: "Обновлённый вопрос: что помогает отдохнуть?",
    answers: saved[0]!.answers.map((answer, index) => ({
      ...answer,
      points: index === 0 ? 43 : answer.points,
    })),
  };
  const updatedPack = { ...validPack, questions: [updatedQuestion] };
  await jsonInput.fill(JSON.stringify(updatedPack));
  await check.click();
  await expect(preview).toContainText(updatedQuestion.prompt);
  await expect(page.locator("body")).toContainText("Обновляемых: 1");
  await expect(
    page.getByRole("radio", { name: /^Обновить совпадающие/ }),
  ).toBeChecked();
  await expect(replaceConsent).not.toBeChecked();
  await expect(save).toBeDisabled();
  expect((await library())[0]!.prompt).toBe(importedQuestion.prompt);
  expect(importRequests).toHaveLength(2);
  await replaceConsent.check();
  await expect(save).toBeEnabled();
  const updateImport = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/questions/import") &&
      response.request().method() === "POST",
  );
  await save.click();
  expect((await updateImport).ok()).toBe(true);
  await expect(page.getByRole("status")).toContainText(
    "Сохранено вопросов: 1.",
  );
  const updated = await library();
  expect(updated).toHaveLength(1);
  expect(updated[0]!.id).toBe(saved[0]!.id);
  expect(updated[0]!.prompt).toBe(updatedQuestion.prompt);
  expect(updated[0]!.answers[0]!.points).toBe(43);
  expect(importRequests).toHaveLength(3);

  await jsonInput.fill(JSON.stringify(updatedPack));
  await check.click();
  await page.getByRole("radio", { name: /^Добавить все как новые/ }).check();
  await expect(save).toBeEnabled();
  await expect(page.locator("body")).toContainText("Новых: 1");
  await expect(page.locator("body")).toContainText("Обновляемых: 0");
  const copyImport = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/questions/import") &&
      response.request().method() === "POST",
  );
  await save.click();
  expect((await copyImport).ok()).toBe(true);
  await expect(page.getByRole("status")).toContainText(
    "Сохранено вопросов: 1.",
  );
  const copied = await library();
  expect(copied).toHaveLength(2);
  const copy = copied.find((question) => question.id !== saved[0]!.id)!;
  expect(copy).toBeDefined();
  expect(copy.prompt).toBe(updatedQuestion.prompt);
  const originalAnswerIds = new Set(
    updated[0]!.answers.map((answer) => answer.id),
  );
  expect(copy.answers.every((answer) => !originalAnswerIds.has(answer.id))).toBe(
    true,
  );
  expect(copied.find((question) => question.id === saved[0]!.id)).toEqual(
    updated[0],
  );
  expect(importRequests).toHaveLength(4);
  await page
    .getByRole("link", { name: "Открыть библиотеку", exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/questions$/);
  await expect(page.locator(".question-library-row")).toHaveCount(2);
  expect(pageErrors).toEqual([]);
});

test("organizer installs and brands the event; independent phones collaborate while guests see only opened answers", async ({
  browser,
  page,
  baseURL,
}, testInfo) => {
  const contexts: BrowserContext[] = [];
  const publicPayloads: string[] = [];
  const publicFrames: string[] = [];
  const publicScripts: string[] = [];
  const responseReads: Promise<void>[] = [];
  const responseReadErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    const grant = await issueSetupToken(pool);
    await page.goto("/");
    await expect(page).toHaveURL(/\/setup$/);
    await fillSecret(page.getByLabel("Код первого запуска"), grant);
    await page.getByLabel("Логин организатора").fill("organizer");
    await fillSecret(page.getByLabel(/^Пароль/), PASSWORD);
    await fillSecret(page.getByLabel("Повторите пароль"), PASSWORD);
    await page.getByRole("button", { name: "Далее: мероприятие" }).click();
    await page
      .getByLabel("Название игры", { exact: true })
      .fill("Вечер друзей");
    await page
      .getByLabel("Организатор", { exact: true })
      .fill("Наш большой праздник");
    await page
      .getByLabel("Заголовок главной", { exact: true })
      .fill("Как хорошо, что мы вместе!");
    await page
      .getByLabel("Подпись на главной", { exact: true })
      .fill("Знакомые лица. Неожиданные ответы.");
    await page
      .getByLabel("Текст внизу страницы", { exact: true })
      .fill("Сделано для нашей компании");
    const logo = Buffer.from(
      await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 64;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#edff7a";
        context.fillRect(0, 0, 64, 64);
        context.fillStyle = "#111222";
        context.font = "bold 36px sans-serif";
        context.fillText("И", 17, 45);
        return canvas.toDataURL("image/png").split(",")[1]!;
      }),
      "base64",
    );
    const uploadedLogos: string[] = [];
    for (const label of [
      "Логотип организатора",
      "Логотип игры",
      "Значок сайта",
      "Логотипы партнёров",
    ]) {
      const uploaded = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/setup/media") &&
          response.request().method() === "POST",
      );
      await page.getByLabel(label, { exact: true }).setInputFiles({
        name: "event-logo.png",
        mimeType: "image/png",
        buffer: logo,
      });
      const response = await uploaded;
      expect(response.ok()).toBe(true);
      const { url } = await response.json();
      expect(url).toMatch(/^\/media\/.+\.png$/);
      uploadedLogos.push(url);
    }
    await page.getByRole("button", { name: "Проектор", exact: true }).click();
    await page.getByRole("tab", { name: "Табло", exact: true }).click();
    await expect(page.getByRole("tabpanel")).toContainText(
      "Что делает вечер незабываемым?",
    );
    await page
      .getByRole("tab", { name: "Табло", exact: true })
      .press("ArrowRight");
    await expect(
      page.getByRole("tab", { name: "Телефон", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page
      .getByRole("button", { name: "Предпросмотр", exact: true })
      .click();
    await page.getByRole("button", { name: "Завершить настройку" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(
      page.getByRole("heading", { name: "Добро пожаловать, организатор" }),
    ).toBeVisible();

    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        name: "Как хорошо, что мы вместе!",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator("body")).toContainText(
      "Знакомые лица. Неожиданные ответы.",
    );
    await expect(page.locator(".public-footer")).toContainText(
      "Сделано для нашей компании",
    );
    await expect(page.locator("body")).not.toContainText("День социолога");
    await expect(page).toHaveTitle("Вечер друзей · Наш большой праздник");
    for (const url of uploadedLogos) {
      expect((await page.request.get(url)).ok()).toBe(true);
    }
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
      "href",
      uploadedLogos[2]!,
    );
    await page.screenshot({
      path: "test-results/home-branding-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/home-branding-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 900 });

    const loginContext = await browser.newContext({ baseURL });
    contexts.push(loginContext);
    const login = await loginContext.newPage();
    await login.goto("/login");
    await login.getByLabel("Логин", { exact: true }).fill("organizer");
    await fillSecret(login.getByLabel("Пароль", { exact: true }), PASSWORD);
    await login.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(login).toHaveURL(/\/admin$/);

    await page.goto("/setup");
    await expect(
      page.getByRole("heading", { name: "Всё уже настроено" }),
    ).toBeVisible();
    await page.goto("/admin/settings");
    await page
      .getByLabel("Описание", { exact: true })
      .fill("Вечер идей, команд и неожиданных ответов.");
    const changedIcon = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/media") &&
        response.request().method() === "POST",
    );
    await page.getByLabel("Значок сайта", { exact: true }).setInputFiles({
      name: "updated-icon.png",
      mimeType: "image/png",
      buffer: logo,
    });
    const changedIconResponse = await changedIcon;
    expect(changedIconResponse.ok()).toBe(true);
    uploadedLogos[2] = (await changedIconResponse.json()).url;
    await expect(
      page.getByRole("button", { name: "Сохранить оформление" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Сохранить оформление" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Оформление сохранено" }),
    ).toBeVisible();
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
      "href",
      uploadedLogos[2]!,
    );
    expect(
      await page
        .locator(".app")
        .evaluate((element) =>
          getComputedStyle(element).getPropertyValue("--primary").trim(),
        ),
    ).toBe("#1646a0");
    await expect(page.locator(".app")).toHaveAttribute("data-theme", "light");
    await page.evaluate(() => window.scrollTo(0, 0));
    await mkdir(path.resolve("test-results"), { recursive: true });
    await page.screenshot({
      path: "test-results/admin-branding-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "test-results/admin-branding-mobile.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });

    const savedBrand = await (await page.request.get("/api/settings")).json();
    expect(
      (
        await page.request.put("/api/settings", {
          data: {
            ...savedBrand,
            title: "О".repeat(120),
            organizer: "О".repeat(100),
            heroTitle: "О".repeat(160),
            description: "О".repeat(200),
            heroNote: "О".repeat(200),
            footerText: "О".repeat(200),
          },
        })
      ).ok(),
    ).toBe(true);
    await page.goto("/");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    expect(
      (await page.request.put("/api/settings", { data: savedBrand })).ok(),
    ).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto("/admin/questions/new");
    await page
      .getByLabel("Вопрос", { exact: true })
      .fill("Учебный вопрос организатора");
    for (let index = 0; index < 6; index++)
      await page
        .getByLabel("Ответ", { exact: true })
        .nth(index)
        .fill(`Не раскрывать вариант ${index + 1}`);
    await page.getByLabel("Демонстрационный вопрос").check();
    await page
      .getByLabel("Источник опроса")
      .fill("Учебный пример. Реальный опрос не проводился.");
    await page
      .getByLabel("Заметки ведущему")
      .fill("Приватная заметка организатора");
    await page
      .getByRole("button", { name: "Сохранить вопрос", exact: true })
      .click();
    await expect(page).toHaveURL(/\/admin\/questions$/);
    await expect(page.locator(".question-library-row")).toHaveCount(1);
    await page.getByRole("button", { name: "Добавить демовопросы" }).click();
    await page.getByRole("button", { name: "Добавить для репетиции" }).click();
    await expect(page.locator(".question-library-row")).toHaveCount(4);
    await expect(page.locator(".question-library-row").first()).toContainText(
      "вымышленные данные",
    );

    await page.goto("/admin/games/new");
    await page
      .getByLabel("Название игры", { exact: true })
      .fill("Праздник · репетиция");
    await page
      .getByLabel("Название", { exact: true })
      .nth(0)
      .fill("Исследователи");
    await page.getByLabel("Название", { exact: true }).nth(1).fill("Аналитики");
    await page
      .locator(".question-option")
      .filter({
        hasText: "Что люди чаще всего делают в общественном транспорте?",
      })
      .locator("input")
      .check();
    await page
      .locator(".question-option")
      .filter({ hasText: "Где люди знакомятся с новыми друзьями?" })
      .locator("input")
      .check();
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/games") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Создать игру", exact: true })
      .click();
    const createdResponse = await created;
    expect(createdResponse.ok()).toBe(true);
    const game = (await createdResponse.json()) as HostGame;
    await expect(page).toHaveURL(new RegExp(`/admin/games/${game.id}$`));
    const [teamA, teamB] = game.teams;
    const firstQuestion = game.questions[0]!;
    const firstAnswer = firstQuestion.answers[0]!;

    async function phone(code: string, name: string) {
      const context = await browser.newContext({
        baseURL,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      contexts.push(context);
      const phonePage = await context.newPage();
      phonePage.on("pageerror", (error) => pageErrors.push(error.message));
      await phonePage.goto("/join");
      await phonePage.getByLabel("Код команды").fill(code);
      await phonePage.getByLabel("Ваше имя", { exact: true }).fill(name);
      await phonePage
        .getByRole("button", { name: "Войти в команду", exact: true })
        .click();
      await expect(phonePage).toHaveURL(new RegExp(`/team/${game.id}$`));
      await expect(
        phonePage.getByText("На связи", { exact: true }),
      ).toBeVisible();
      return phonePage;
    }
    const captain = await phone(teamA!.joinCode, "Мария · капитан");
    const member = await phone(teamA!.joinCode, "Алексей · игрок");
    const rival = await phone(teamB!.joinCode, "Ольга · соперник");
    const guestContext = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 900 },
    });
    contexts.push(guestContext);
    const board = await guestContext.newPage();
    board.on("pageerror", (error) => pageErrors.push(error.message));
    board.on("response", (response) => {
      // Redirects and 304 cache responses do not expose a response body.
      if (!response.ok()) return;
      const destination = response.url().includes("/api/")
        ? publicPayloads
        : response.request().resourceType() === "script"
          ? publicScripts
          : null;
      if (destination)
        responseReads.push(
          response
            .text()
            .then((text) => {
              destination.push(text);
            })
            .catch(() => {
              responseReadErrors.push(
                "Unable to inspect a successful public response",
              );
            }),
        );
    });
    board.on("websocket", (socket) => {
      socket.on("framereceived", (event) =>
        publicFrames.push(String(event.payload)),
      );
    });
    await board.goto(`/board/${game.id}`);
    await expect(
      board.getByRole("heading", { name: "Собираем команды" }),
    ).toBeVisible();
    await expect(board.getByText("На связи", { exact: true })).toBeVisible();
    await expect(board.locator(".board-brand")).toContainText("Вечер друзей");
    await expect(board.locator(".board-footer")).toContainText(
      "Сделано для нашей компании",
    );
    await expect(board.locator(".board-brand img")).toHaveAttribute(
      "src",
      uploadedLogos[1]!,
    );
    await board
      .getByRole("button", { name: "Для проектора", exact: true })
      .click();
    await expect(
      board.getByRole("button", { name: "Для проектора", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(board.locator(".board-page")).toHaveAttribute(
      "data-theme",
      "light",
    );
    await expect(board.locator(".board-page")).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
    await board.setViewportSize({ width: 390, height: 844 });
    expect(
      await board.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await board.setViewportSize({ width: 1440, height: 900 });
    await expect(board.locator("body")).not.toContainText(firstQuestion.prompt);

    await page.goto(`/host/${game.id}`);
    await expect(page.getByText("На связи", { exact: true })).toBeVisible();
    await page
      .locator(".host-player-list li")
      .filter({ hasText: "Мария · капитан" })
      .getByRole("button", { name: "Назначить капитаном" })
      .click();
    await expect(
      captain.getByLabel("Итоговый ответ", { exact: true }),
    ).toBeVisible();
    await expect(
      member.getByLabel("Итоговый ответ", { exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("Первой отвечает").selectOption(teamA!.id);
    await page
      .getByRole("button", { name: "Начать игру", exact: true })
      .click();
    await expect(
      board.getByRole("heading", { name: firstQuestion.prompt, exact: true }),
    ).toBeVisible();
    await expect(board.locator(".board-answer.closed")).toHaveCount(
      firstQuestion.answers.length,
    );
    await expect(board.locator("body")).not.toContainText(firstAnswer.text);
    await expect(
      rival.getByRole("button", { name: "Предложить ответ" }),
    ).toBeDisabled();
    await Promise.all(responseReads);
    expect(responseReadErrors).toEqual([]);
    expect(publicScripts.length).toBeGreaterThan(0);
    const preRevealPayloads = publicPayloads.join("\n");
    for (const hidden of [
      firstAnswer.text,
      game.questions[1]!.prompt,
      teamA!.joinCode,
      firstQuestion.notes,
    ])
      expect(preRevealPayloads).not.toContain(hidden);
    // Demopacks are imported by an authenticated server endpoint. Bundled
    // browser JavaScript must not carry their unrevealed answers either.
    expect(publicScripts.join("\n")).not.toContain(firstAnswer.text);

    await member.getByLabel("Ваше предложение").fill(firstAnswer.text);
    await expect(
      member.getByRole("button", { name: "Предложить ответ" }),
    ).toBeEnabled();
    await member.getByRole("button", { name: "Предложить ответ" }).click();
    await expect(captain.locator(".suggestion-list")).toContainText(
      firstAnswer.text,
    );
    await expect(rival.locator(".suggestion-list")).toHaveCount(0);
    await captain.getByRole("button", { name: "Выбрать", exact: true }).click();
    await expect(captain.getByLabel("Итоговый ответ")).toHaveValue(
      firstAnswer.text,
    );
    await captain
      .getByRole("button", { name: "Отправить ответ ведущему" })
      .click();
    await expect(page.locator(".host-pending")).toContainText(firstAnswer.text);
    await expect(rival.locator(".pending-team-answer")).toHaveCount(0);
    await expect(board.locator("body")).not.toContainText(firstAnswer.text);
    expect(publicPayloads.join("\n")).not.toContain(firstAnswer.text);
    await page
      .locator(".host-answer")
      .filter({ hasText: firstAnswer.text })
      .getByRole("button", { name: "Открыть", exact: true })
      .click();
    await expect(board.locator(".board-answer.opened")).toHaveCount(1);
    await expect(board.locator(".board-answer.opened")).toContainText(
      firstAnswer.text,
    );
    await expect(captain.locator(".pending-team-answer")).toHaveCount(0);
    await expect(page.locator(".host-status-bar")).toContainText(
      `Банк: ${firstAnswer.points}`,
    );
    expect(publicFrames.length).toBeGreaterThan(0);
    for (const frame of publicFrames) {
      const parsed = JSON.parse(frame) as Record<string, unknown>;
      expect(Object.keys(parsed).sort()).toEqual(["revision", "type"]);
      expect(parsed.type).toBe("changed");
      expect(typeof parsed.revision).toBe("number");
    }

    await page.getByRole("button", { name: "Пауза", exact: true }).click();
    await expect(
      board.getByRole("heading", { name: "Игра на паузе" }),
    ).toBeVisible();
    await member
      .getByLabel("Ваше предложение")
      .fill("Черновик для продолжения");
    await member.reload();
    await expect(member.getByLabel("Ваше предложение")).toHaveValue(
      "Черновик для продолжения",
    );
    await expect(
      member.getByRole("button", { name: "Предложить ответ" }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Продолжить игру", exact: true })
      .click();
    await expect(
      board.getByRole("heading", { name: "Игра на паузе" }),
    ).toHaveCount(0);
    await expect(
      member.getByRole("button", { name: "Предложить ответ" }),
    ).toBeEnabled();
    await page
      .locator(".host-team-actions")
      .filter({ hasText: "Исследователи" })
      .getByRole("button", { name: "Присудить банк" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Подтвердить" })
      .click();
    await expect(board.locator(".board-round-complete")).toBeVisible();
    await expect(board.locator(".round-statistics")).toBeVisible();
    for (const answer of firstQuestion.answers) {
      await expect(board.locator(".statistics-answer-list")).toContainText(
        answer.text,
      );
    }
    await expect(board.locator(".round-statistics")).toContainText(
      "Угадали 1 из",
    );
    await expect(board.locator("body")).not.toContainText(
      game.questions[1]!.prompt,
    );
    await board.setViewportSize({ width: 1280, height: 720 });
    await board.screenshot({
      path: "test-results/round-statistics-projector.png",
      fullPage: true,
    });
    expect(
      await board.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight + 1,
      ),
    ).toBe(true);
    await board.setViewportSize({ width: 1440, height: 900 });
    await expect(
      board.locator(".team-score").filter({ hasText: "Исследователи" }),
    ).toContainText(String(firstAnswer.points));
    await page
      .getByRole("button", { name: "Следующий раунд", exact: true })
      .click();
    await expect(
      board.getByRole("heading", {
        name: game.questions[1]!.prompt,
        exact: true,
      }),
    ).toBeVisible();
    await expect(board.locator(".board-answer.opened")).toHaveCount(0);

    await mkdir(path.resolve("test-results"), { recursive: true });
    await board.screenshot({
      path: "test-results/board-desktop.png",
      fullPage: true,
    });
    await captain.screenshot({
      path: "test-results/team-mobile.png",
      fullPage: true,
    });
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
    }
    await page.screenshot({
      path: "test-results/host-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(
      await captain.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await testInfo.attach("Общее табло", {
      path: "test-results/board-desktop.png",
      contentType: "image/png",
    });
    await testInfo.attach("Телефон капитана", {
      path: "test-results/team-mobile.png",
      contentType: "image/png",
    });
    await page
      .getByRole("button", { name: "Завершить игру", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Подтвердить" })
      .click();
    await expect(
      board.getByRole("heading", { name: "Игра завершена", exact: true }),
    ).toBeVisible();
    await expect(
      board.getByRole("heading", {
        name: "Победители — Исследователи",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      member.getByRole("heading", { name: "Вы сыграли вместе!" }),
    ).toBeVisible();
    await board.reload();
    await expect(
      board.getByRole("heading", {
        name: "Победители — Исследователи",
        exact: true,
      }),
    ).toBeVisible();

    const results = await guestContext.newPage();
    results.on("pageerror", (error) => pageErrors.push(error.message));
    await results.goto(`/results/${game.id}`);
    await expect(
      results.getByRole("heading", {
        name: "Итоги пока недоступны",
        exact: true,
      }),
    ).toBeVisible();
    const privateReport = await page.request.get(
      `/api/games/${game.id}/results`,
    );
    expect(privateReport.ok()).toBe(true);
    expect((await privateReport.json()).published).toBe(false);
    await page
      .getByRole("button", { name: "Опубликовать итоги", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Скрыть итоги", exact: true }),
    ).toBeVisible();
    await expect(
      board.getByRole("link", { name: "Ответы и итоги", exact: true }),
    ).toBeVisible();
    await results.reload();
    await expect(
      results.getByRole("heading", { name: "Итоги игры", exact: true }),
    ).toBeVisible();
    await expect(results.locator(".round-statistics")).toHaveCount(2);
    await expect(results.locator("body")).not.toContainText(
      firstQuestion.notes,
    );
    await results.screenshot({
      path: "test-results/results-desktop.png",
      fullPage: true,
    });
    await results.setViewportSize({ width: 390, height: 844 });
    expect(
      await results.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await results.screenshot({
      path: "test-results/results-mobile.png",
      fullPage: true,
    });

    await page
      .getByRole("button", { name: "Скрыть итоги", exact: true })
      .click();
    await results.reload();
    await expect(
      results.getByRole("heading", {
        name: "Итоги пока недоступны",
        exact: true,
      }),
    ).toBeVisible();
    await page.goto(`/admin/games/${game.id}`);
    await page
      .getByRole("button", { name: "Начать заново", exact: true })
      .click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(
      (await (await page.request.get(`/api/games/${game.id}/host`)).json())
        .phase,
    ).toBe("finished");
    await page
      .getByRole("button", { name: "Начать заново", exact: true })
      .click();
    const resetting = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/games/${game.id}/reset`) &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Начать заново", exact: true })
      .click();
    const resetResponse = await resetting;
    expect(resetResponse.ok()).toBe(true);
    const resetGame = (await resetResponse.json()) as HostGame;
    expect(resetGame.teams.map((team) => team.score)).toEqual([0, 0]);
    expect(resetGame.players).toEqual([]);
    expect(resetGame.roundResults).toEqual([]);
    expect(resetGame.teams[0]!.joinCode).not.toBe(teamA!.joinCode);
    await expect(
      board.getByRole("heading", { name: "Собираем команды", exact: true }),
    ).toBeVisible();
    await expect(
      member.getByRole("link", { name: "Войти по приглашению команды" }),
    ).toBeVisible();
    await expect(member.getByLabel("Ваше предложение")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Удалить игру", exact: true })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Удалить игру", exact: true })
      .click();
    await expect(page).toHaveURL(/\/admin\/games$/);
    await expect(board.locator(".board-page")).toHaveCount(0);
    expect(
      (await page.request.get(`/api/games/${game.id}/public`)).status(),
    ).toBe(404);
    expect(
      (await (await page.request.get("/api/questions")).json()).length,
    ).toBe(4);
    expect(pageErrors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
