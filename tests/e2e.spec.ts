import { mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import pg from "pg";
import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { issueSetupToken, passwordHash } from "../server/db";
import { parseQuestionPack } from "../shared/questionImport";
import {
  defaultBrand,
  type HostCommand,
  type HostGame,
  type PublicGame,
  type PublicGameResults,
  type Question,
} from "../shared/types";

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

function packFixture(prompt: string, pack = ""): Question {
  return {
    id: randomUUID(), prompt,
    answers: [
      { id: randomUUID(), text: `Ответ на ${prompt}`, points: 3, aliases: ["Учебный синоним"], originals: ["Учебная исходная формулировка"] },
      { id: randomUUID(), text: "Другой вариант", points: 1, aliases: [] },
    ],
    source: "Вымышленный опрос для проверки наборов", surveyDate: "2026-10-16",
    respondentCount: 4, notes: "Приватная заметка о наборе", isDemo: true, pack,
  };
}

// These scenarios exercise organizer features, while the existing onboarding
// scenarios keep testing the real setup flow. A fixture in this run's isolated
// schema avoids exhausting setup's production limit of five requests/minute.
async function seedOrganizer(page: Page) {
  await pool.query("INSERT INTO admins(id,username,password_hash) VALUES($1,$2,$3)", [randomUUID(), "organizer", await passwordHash(PASSWORD)]);
  await pool.query("UPDATE app_settings SET initialized=true,brand=$1::jsonb WHERE id=1", [JSON.stringify(defaultBrand)]);
  expect((await page.request.post("/api/login", { data: { username: "organizer", password: PASSWORD } })).ok()).toBe(true);
}

test("organizer names an imported pack, moves questions in bulk and creates a stable game before safely deleting library questions", async ({ page }) => {
  const pageErrors: string[] = [];
  const batches: { action: string; ids: string[]; pack?: string }[] = [];
  const gamePosts: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/questions/batch")
      batches.push(request.postDataJSON());
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/games")
      gamePosts.push(request.url());
  });
  await seedOrganizer(page);
  const questions = [
    packFixture("Что помогает начать беседу?", "Старый набор А"),
    packFixture("Что берут на прогулку?", "Старый набор Б"),
    packFixture("Где встречают друзей?"),
  ];
  const sourceQuestions = structuredClone(questions);
  const library = async (): Promise<Question[]> => {
    const response = await page.request.get("/api/questions");
    expect(response.ok()).toBe(true);
    return response.json();
  };
  await page.goto("/admin/questions/import");
  await page.getByLabel("Готовый JSON", { exact: true }).fill(JSON.stringify({
    format: "ctokodnomy-questions-v1", questions,
  }));
  const packName = page.getByLabel("Название набора", { exact: true });
  const check = page.getByRole("button", { name: "Проверить вопросы", exact: true });
  const save = page.getByRole("button", { name: "Сохранить вопросы", exact: true });
  const preview = page.getByRole("region", { name: "Предпросмотр вопросов", exact: true });
  await packName.fill("Первое название");
  await check.click();
  await expect(preview).toContainText("Первое название");
  await expect(save).toBeEnabled();
  await packName.fill("Общий опрос");
  await expect(save).toBeDisabled();
  await expect(preview).toHaveCount(0);
  await check.click();
  await expect(preview).toContainText("Общий опрос");
  await mkdir(path.resolve("test-results"), { recursive: true });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: "test-results/named-pack-import-desktop.png", fullPage: true });
  await save.click();
  await expect(page.getByRole("status")).toContainText("Сохранено вопросов: 3.");
  expect((await library()).map((question) => question.pack)).toEqual(["Общий опрос", "Общий опрос", "Общий опрос"]);
  // Applying a pack changes no aliases, originals or other question content.
  expect(await library()).toEqual(sourceQuestions.map((question) => ({ ...question, pack: "Общий опрос" })));

  await page.goto("/admin/questions");
  await page.getByRole("button", { name: "Переименовать набор: Общий опрос", exact: true }).click();
  await page.getByLabel("Новое название набора", { exact: true }).fill("Вечер знакомств");
  await page.getByRole("button", { name: "Сохранить название", exact: true }).click();
  await expect(page.getByRole("button", { name: "Показать набор: Вечер знакомств", exact: true })).toBeVisible();
  expect((await library()).every((question) => question.pack === "Вечер знакомств")).toBe(true);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: "test-results/question-packs-desktop.png", fullPage: true });

  const choose = (question: Question) => page.getByRole("checkbox", { name: `Выбрать вопрос: ${question.prompt}`, exact: true });
  const bulk = page.getByRole("region", { name: "Действия с выбранными вопросами", exact: true });
  await choose(questions[0]!).check();
  await choose(questions[1]!).check();
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const bulkDestination = bulk.getByLabel("Набор для выбранных вопросов", { exact: true });
  await bulkDestination.selectOption("new");
  await bulk.getByLabel("Название нового набора", { exact: true }).fill("Для прогулки");
  const move = bulk.getByRole("button", { name: "В набор", exact: true });
  await move.click({ trial: true });
  expect((await move.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await mkdir(path.resolve("test-results"), { recursive: true });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: "test-results/question-packs-mobile.png", fullPage: true });
  await move.click();
  await expect(page.getByRole("button", { name: "Показать набор: Для прогулки", exact: true })).toBeVisible();
  expect(batches.at(-1)).toEqual({ action: "move", ids: questions.slice(0, 2).map((question) => question.id), pack: "Для прогулки" });

  await page.getByRole("button", { name: "Показать набор: Для прогулки", exact: true }).click();
  await expect(page.locator(".question-library-row")).toHaveCount(2);
  await page.getByRole("button", { name: "Выбрать все показанные", exact: true }).click();
  await bulk.getByRole("button", { name: "Убрать из набора", exact: true }).click();
  await expect(page.getByRole("button", { name: "Показать набор: Без набора", exact: true })).toBeVisible();
  expect((await library()).filter((question) => !question.pack).map((question) => question.id)).toEqual(questions.slice(0, 2).map((question) => question.id));
  await page.getByRole("button", { name: "Показать набор: Без набора", exact: true }).click();
  await page.getByRole("button", { name: "Выбрать все показанные", exact: true }).click();
  await bulk.getByLabel("Набор для выбранных вопросов", { exact: true }).selectOption({ label: "Вечер знакомств" });
  await bulk.getByRole("button", { name: "В набор", exact: true }).click();
  await expect(page.getByRole("button", { name: "Показать набор: Вечер знакомств", exact: true })).toBeVisible();
  expect((await library()).every((question) => question.pack === "Вечер знакомств")).toBe(true);

  await page.goto("/admin/games/new");
  await page.getByLabel("Название игры", { exact: true }).fill("Игра из одного набора");
  const pickerPack = page.getByLabel("Набор вопросов", { exact: true });
  const namedOption = pickerPack.locator("option").filter({ hasText: "Вечер знакомств" });
  await pickerPack.selectOption((await namedOption.getAttribute("value"))!);
  // Choosing the complete pack must include even questions hidden by search.
  await page.getByLabel("Поиск вопросов", { exact: true }).fill(questions[0]!.prompt);
  await expect(page.locator(".question-option")).toHaveCount(1);
  await page.getByRole("button", { name: "Выбрать набор целиком", exact: true }).click();
  await expect(page.locator(".selected-question")).toHaveCount(3);
  await page.getByLabel("Поиск вопросов", { exact: true }).press("Enter");
  await expect(page).toHaveURL(/\/admin\/games\/new$/);
  await expect(page.getByLabel("Название игры", { exact: true })).toBeVisible();
  expect(gamePosts).toEqual([]);
  await page.locator(".selected-question").first().getByLabel("Очки", { exact: true }).selectOption("2");
  await page.getByRole("button", { name: "Добавить набор к выбранным", exact: true }).click();
  await expect(page.locator(".selected-question")).toHaveCount(3);
  await expect(page.locator(".selected-question").first().getByLabel("Очки", { exact: true })).toHaveValue("2");
  await page.getByRole("button", { name: "Опустить раунд 1", exact: true }).click();
  await expect(page.locator(".selected-question").nth(1)).toContainText(questions[0]!.prompt);
  await expect(page.locator(".selected-question").nth(1).getByLabel("Очки", { exact: true })).toHaveValue("2");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: "test-results/game-pack-picker-mobile.png", fullPage: true });
  const creating = page.waitForResponse((response) => response.url().endsWith("/api/games") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Создать игру", exact: true }).click();
  const created = await creating;
  expect(created.ok()).toBe(true);
  const game = await created.json() as HostGame;
  expect(gamePosts).toHaveLength(1);
  expect(game.questions.map((question) => question.id)).toEqual([questions[1]!.id, questions[0]!.id, questions[2]!.id]);
  expect(game.rules.multipliers).toEqual([1, 2, 1]);

  await page.goto("/admin/questions");
  await choose(questions[0]!).check();
  const search = page.getByLabel("Поиск в библиотеке", { exact: true });
  await search.fill(questions[1]!.prompt);
  await expect(page.locator(".question-library-row")).toHaveCount(1);
  await choose(questions[1]!).check();
  await bulk.getByRole("button", { name: "Удалить выбранные", exact: true }).click();
  const deleting = page.getByRole("alertdialog", { name: "Удалить выбранные вопросы?", exact: true });
  await expect(deleting).toContainText(questions[1]!.prompt);
  await expect(deleting).not.toContainText(questions[0]!.prompt);
  const beforeCancel = batches.length;
  await deleting.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(deleting).toHaveCount(0);
  expect(batches).toHaveLength(beforeCancel);
  expect(await library()).toHaveLength(3);
  await bulk.getByRole("button", { name: "Удалить выбранные", exact: true }).click();
  await deleting.getByRole("button", { name: "Удалить вопросы", exact: true }).click();
  await expect(deleting).toHaveCount(0);
  expect(batches.at(-1)).toEqual({ action: "delete", ids: [questions[1]!.id] });
  expect((await library()).map((question) => question.id)).toEqual([questions[0]!.id, questions[2]!.id]);
  await search.clear();
  await page.getByRole("button", { name: "Снять весь выбор", exact: true }).click();
  await page.getByRole("button", { name: "Выбрать все показанные", exact: true }).click();
  await bulk.getByRole("button", { name: "Удалить выбранные", exact: true }).click();
  await expect(deleting).toContainText(questions[0]!.prompt);
  await expect(deleting).toContainText(questions[2]!.prompt);
  await deleting.getByRole("button", { name: "Удалить вопросы", exact: true }).click();
  await expect(deleting).toHaveCount(0);
  expect(batches.at(-1)).toEqual({ action: "delete", ids: [questions[0]!.id, questions[2]!.id] });
  expect(await library()).toEqual([]);
  const snapshotResponse = await page.request.get(`/api/games/${game.id}/host`);
  expect(snapshotResponse.ok()).toBe(true);
  const snapshot = await snapshotResponse.json() as HostGame;
  expect(snapshot.questions).toEqual(game.questions);
  expect(snapshot.rules.multipliers).toEqual([1, 2, 1]);
  expect(snapshot.questions.every((question) => question.pack === "Вечер знакомств")).toBe(true);
  expect(pageErrors).toEqual([]);
});

test("a game pack larger than twenty rounds never leaves a partial selection", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await seedOrganizer(page);
  const first = packFixture("Отдельный выбранный вопрос", "Короткий набор");
  const oversized = Array.from({ length: 21 }, (_, index) => packFixture(`Большой набор: вопрос ${index + 1}`, "Большой набор"));
  expect((await page.request.post("/api/questions/import", { data: {
    format: "ctokodnomy-questions-v1", questions: [first, ...oversized],
  } })).ok()).toBe(true);
  await page.goto("/admin/games/new");
  await page.locator(".question-option").filter({ hasText: first.prompt }).locator('input[type="checkbox"]').check();
  await page.locator(".selected-question").getByLabel("Очки", { exact: true }).selectOption("3");
  const pickerPack = page.getByLabel("Набор вопросов", { exact: true });
  const option = pickerPack.locator("option").filter({ hasText: "Большой набор" });
  await pickerPack.selectOption((await option.getAttribute("value"))!);
  for (const action of ["Выбрать набор целиком", "Добавить набор к выбранным"]) {
    await page.getByRole("button", { name: action, exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("20");
    await expect(page.locator(".selected-question")).toHaveCount(1);
    await expect(page.locator(".selected-question")).toContainText(first.prompt);
    await expect(page.locator(".selected-question").getByLabel("Очки", { exact: true })).toHaveValue("3");
    await expect(page.locator('.question-option input[type="checkbox"]:checked')).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Очистить выбор", exact: true }).click();
  await expect(page.locator(".selected-question")).toHaveCount(0);
  const shortOption = pickerPack.locator("option").filter({ hasText: "Короткий набор" });
  await pickerPack.selectOption((await shortOption.getAttribute("value"))!);
  await page.getByRole("button", { name: "Выбрать набор целиком", exact: true }).click();
  await expect(page.locator(".selected-question").getByLabel("Очки", { exact: true })).toHaveValue("1");
  await page.getByRole("button", { name: "Очистить выбор", exact: true }).click();
  await pickerPack.selectOption((await option.getAttribute("value"))!);
  await page.getByLabel("Поиск вопросов", { exact: true }).fill("Большой набор: вопрос 21");
  await page.getByRole("button", { name: "Добавить найденные", exact: true }).click();
  await expect(page.locator(".selected-question")).toHaveCount(1);
  await expect(page.locator(".selected-question")).toContainText(oversized[20]!.prompt);
  await page.getByRole("button", { name: "Убрать найденные", exact: true }).click();
  await expect(page.locator(".selected-question")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("organizer folds cards with the keyboard, keeps form values and reaches every admin section on a narrow phone", async ({ page }) => {
  const pageErrors: string[] = [];
  const gamePosts: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/games")
      gamePosts.push(request.url());
  });
  await seedOrganizer(page);
  const questions = [packFixture("Первый вопрос карточки", "Набор карточек"), packFixture("Второй вопрос карточки", "Набор карточек"), packFixture("Вопрос другого набора", "Другой набор")];
  expect((await page.request.post("/api/questions/import", { data: {
    format: "ctokodnomy-questions-v1", questions,
  } })).ok()).toBe(true);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/admin/questions");
  const pack = page.getByRole("button", { name: "Показать набор: Набор карточек", exact: true });
  await pack.click();
  await expect(pack).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".question-library-row")).toHaveCount(2);
  await pack.click();
  await expect(pack).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".question-library-row")).toHaveCount(3);
  const questionRow = page.locator(".question-library-row").filter({ hasText: questions[0]!.prompt });
  const disclosure = questionRow.locator("details");
  const questionHeader = disclosure.locator("summary");
  const rowChoice = questionRow.getByRole("checkbox", { name: `Выбрать вопрос: ${questions[0]!.prompt}`, exact: true });
  await expect(disclosure).toHaveJSProperty("open", false);
  await expect(questionRow.getByRole("link", { name: "Редактировать", exact: true })).not.toBeVisible();
  await rowChoice.check();
  await expect(disclosure).toHaveJSProperty("open", false);
  await questionHeader.press("Enter");
  await expect(disclosure).toHaveJSProperty("open", true);
  await expect(questionRow.getByRole("link", { name: "Редактировать", exact: true })).toBeVisible();
  await questionHeader.press("Space");
  await expect(disclosure).toHaveJSProperty("open", false);
  await expect(rowChoice).toBeChecked();

  const shortcuts = page.getByRole("navigation", { name: "Быстрые действия", exact: true });
  await shortcuts.getByRole("link", { name: "Новая игра", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/games\/new$/);
  const gameTitle = page.getByLabel("Название игры", { exact: true });
  const teamsCard = page.locator("details").filter({ has: gameTitle });
  const teamsHeader = teamsCard.locator(":scope > summary");
  await expect(teamsCard).toHaveJSProperty("open", true);
  await gameTitle.fill("Сворачиваемая репетиция");
  await teamsHeader.click();
  await expect(gameTitle).not.toBeVisible();
  await teamsHeader.press("Space");
  await expect(gameTitle).toHaveValue("Сворачиваемая репетиция");
  await page.getByLabel("Набор вопросов", { exact: true }).selectOption("pack:Набор карточек");
  await page.getByRole("button", { name: "Выбрать набор целиком", exact: true }).click();
  // Browser validation must reveal and focus a required field in a closed card.
  await gameTitle.clear();
  await teamsHeader.click();
  await page.getByRole("button", { name: "Создать игру", exact: true }).click();
  await expect(teamsCard).toHaveJSProperty("open", true);
  await expect(gameTitle).toBeFocused();
  expect(gamePosts).toEqual([]);
  await gameTitle.fill("Сворачиваемая репетиция");
  const creating = page.waitForResponse((response) => response.url().endsWith("/api/games") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Создать игру", exact: true }).click();
  const response = await creating;
  expect(response.ok()).toBe(true);
  const game = await response.json() as HostGame;
  await page.goto("/admin/games");
  const gameCard = page.locator(".game-card").filter({ hasText: game.title });
  const gameHeader = gameCard.locator(":scope > summary");
  await expect(gameCard).toHaveJSProperty("open", false);
  await expect(gameCard.getByRole("link", { name: "Открыть пульт", exact: true })).not.toBeVisible();
  await gameHeader.press("Enter");
  await expect(gameCard.getByRole("link", { name: "Открыть пульт", exact: true })).toBeVisible();
  await gameHeader.press("Space");
  await expect(gameCard).toHaveJSProperty("open", false);
  expect((await (await page.request.get(`/api/games/${game.id}/host`)).json()).questions).toEqual(game.questions);

  const navigation = page.getByRole("navigation", { name: "Разделы администрирования", exact: true });
  for (const name of ["Обзор", "Игры", "Вопросы", "Оформление", "Аккаунт"]) {
    const link = navigation.getByRole("link", { name, exact: true });
    await expect(link).toBeInViewport();
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await link.click();
    await expect(link).toHaveAttribute("aria-current", "page");
    await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await navigation.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
  const currentPassword = page.getByLabel("Текущий пароль", { exact: true });
  const accountCard = page.locator("details").filter({ has: currentPassword });
  await fillSecret(currentPassword, PASSWORD);
  await accountCard.locator(":scope > summary").press("Enter");
  await expect(currentPassword).not.toBeVisible();
  await accountCard.locator(":scope > summary").press("Space");
  await expect(currentPassword).toHaveValue(PASSWORD);
  await navigation.getByRole("link", { name: "Оформление", exact: true }).click();
  const hero = page.getByLabel("Заголовок главной", { exact: true });
  const brandingCard = page.locator("details.collapsible-card").filter({ has: hero });
  await hero.fill("Текст остаётся после сворачивания");
  await brandingCard.locator(":scope > summary").click();
  await expect(hero).not.toBeVisible();
  await brandingCard.locator(":scope > summary").press("Enter");
  await expect(hero).toHaveValue("Текст остаётся после сворачивания");
  await page.getByRole("button", { name: "Сохранить оформление", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Оформление сохранено");
  expect((await (await page.request.get("/api/settings")).json()).heroTitle).toBe("Текст остаётся после сворачивания");
  await shortcuts.getByRole("link", { name: "Импорт вопросов", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/questions\/import$/);
  await expect(page.getByRole("heading", { name: "Импорт вопросов", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(gamePosts).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});

test("organizer keeps a local light theme, navigates on a phone and safely controls the audience board", async ({
  browser,
  page,
  baseURL,
}) => {
  const pageErrors: string[] = [];
  const settingsWrites: string[] = [];
  const commands: HostCommand[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "PUT" && pathname === "/api/settings")
      settingsWrites.push(pathname);
    if (request.method() === "POST" && pathname.endsWith("/commands"))
      commands.push(request.postDataJSON().command as HostCommand);
  });
  expect((await page.request.post("/api/setup", { data: {
    token: await issueSetupToken(pool), username: "organizer", password: PASSWORD,
    brand: defaultBrand,
  } })).ok()).toBe(true);
  await page.goto("/admin");
  const appearance = page.getByLabel("Тема интерфейса", { exact: true });
  await expect(appearance).toHaveValue("light");
  await expect(page.locator(".app")).toHaveAttribute("data-theme", "light");
  await appearance.selectOption("dark");
  await expect(page.locator(".app")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(appearance).toHaveValue("dark");
  await appearance.selectOption("brand");
  await expect(page.locator(".app")).toHaveAttribute("data-theme", "dark");
  await appearance.selectOption("light");
  await page.reload();
  await expect(appearance).toHaveValue("light");
  expect(settingsWrites).toEqual([]);
  expect(await (await page.request.get("/api/settings")).json()).toEqual(defaultBrand);

  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/admin/questions/import");
  const navigation = page.getByRole("navigation", { name: "Разделы администрирования", exact: true });
  await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(navigation.getByRole("link", { name: "Вопросы", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Импорт вопросов", exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await navigation.getByRole("link", { name: "Аккаунт", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/account$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByRole("heading", { name: "Мой аккаунт", exact: true })).toBeInViewport();
  await navigation.getByRole("link", { name: "Вопросы", exact: true }).click();
  await page.getByRole("link", { name: "Импорт JSON", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/questions\/import$/);
  const breadcrumbs = page.getByRole("navigation", { name: "Путь к странице", exact: true });
  await expect(breadcrumbs).toBeVisible();
  await expect(breadcrumbs.getByRole("link", { name: "Вопросы", exact: true })).toHaveAttribute("href", "/admin/questions");
  await breadcrumbs.getByRole("link", { name: "Вопросы", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/questions$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await mkdir(path.resolve("test-results"), { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: "test-results/admin-light-ui.png", fullPage: true });

  const question: Question = {
    id: randomUUID(), prompt: "Что помогает команде придумать хороший ответ?",
    answers: Array.from({ length: 8 }, (_, index) => ({
      id: randomUUID(), text: `Вариант команды ${index + 1}`, points: 8 - index, aliases: [],
      ...(index === 7 ? { originals: ["Приватный исходный текст"] } : {}),
    })),
    source: "Вымышленный опрос для проверки пульта", surveyDate: "2026-10-15",
    respondentCount: 36, notes: "Только для организатора", isDemo: true, pack: "Пульт",
  };
  expect((await page.request.post("/api/questions/import", {
    data: { format: "ctokodnomy-questions-v1", questions: [question] },
  })).ok()).toBe(true);
  const created = await page.request.post("/api/games", { data: {
    title: "Репетиция с удобным пультом", questionIds: [question.id],
    teams: [{ name: "Исследователи", color: "#1646a0" }, { name: "Аналитики", color: "#8146c3" }],
  } });
  expect(created.ok()).toBe(true);
  const game = await created.json() as HostGame;
  expect(game.brand).toEqual(defaultBrand);
  const guestContext = await browser.newContext({ baseURL, viewport: { width: 1280, height: 720 } });
  try {
    const board = await guestContext.newPage();
    board.on("pageerror", (error) => pageErrors.push(error.message));
    await board.goto(`/board/${game.id}`);
    const projector = board.getByRole("button", { name: "Для проектора", exact: true });
    if (await projector.getAttribute("aria-pressed") !== "true") await projector.click();
    await expect(board.locator(".board-page")).toHaveAttribute("data-theme", "light");
    await page.goto(`/host/${game.id}`);
    await page.locator("details.host-round-controls > summary").click();
    const shortcuts = page.getByRole("checkbox", { name: "Горячие клавиши", exact: true });
    await expect(shortcuts).not.toBeChecked();
    await page.getByRole("button", { name: "Начать игру", exact: true }).click();
    await expect(board.locator(".board-answer.closed")).toHaveCount(6);
    await page.locator("h1").click();
    await page.keyboard.press("1");
    await expect(board.locator(".board-answer.closed")).toHaveCount(6);
    expect(commands.map((command) => command.type)).toEqual(["start"]);
    await shortcuts.check();

    // Typing, modifiers and repeated keydowns must never issue game commands.
    await page.getByText("Исправить счёт", { exact: true }).click();
    const reason = page.getByLabel("Причина исправления", { exact: true });
    await reason.focus();
    await page.keyboard.type("1p");
    await expect(reason).toHaveValue("1p");
    await page.locator("h1").click();
    await page.keyboard.press("Control+1");
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "1", repeat: true, bubbles: true })));
    await expect(board.locator(".board-answer.closed")).toHaveCount(6);
    expect(commands.map((command) => command.type)).toEqual(["start"]);
    await page.keyboard.press("1");
    await expect(board.locator(".board-answer.closed")).toHaveCount(5);
    await expect(page.locator(".host-answer").first().getByRole("button", { name: "Открыт", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Пауза", exact: true })).toBeEnabled();
    await page.keyboard.press("p");
    await expect(page.getByRole("button", { name: "Продолжить игру", exact: true })).toBeEnabled();
    await page.keyboard.press("p");
    await expect(page.getByRole("button", { name: "Пауза", exact: true })).toBeEnabled();
    await page.keyboard.press("u");
    const confirmation = page.getByRole("dialog", { name: "Подтвердите решение", exact: true });
    await expect(confirmation).toBeVisible();
    const beforeConfirmation = commands.length;
    await page.keyboard.press("2");
    await page.keyboard.press("p");
    expect(commands).toHaveLength(beforeConfirmation);
    await expect(board.locator(".board-answer.closed")).toHaveCount(5);
    await confirmation.getByRole("button", { name: "Отмена", exact: true }).click();
    await page.locator("h1").click();
    await page.keyboard.press("u");
    await confirmation.getByRole("button", { name: "Подтвердить", exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Продолжить игру", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Продолжить игру", exact: true }).click();
    await expect(page.getByRole("button", { name: "Пауза", exact: true })).toBeVisible();
    const hostNavigation = page.getByRole("navigation", { name: "Разделы пульта", exact: true });
    for (const link of await hostNavigation.getByRole("link").all()) {
      const target = await link.getAttribute("href");
      expect(target).toMatch(/^#host-/);
      await expect(page.locator(target!)).toHaveCount(1);
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.screenshot({ path: "test-results/host-desktop-ui.png", fullPage: true });
    await page.setViewportSize({ width: 320, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const mobileReveal = page.locator(".host-answer").nth(1).getByRole("button", { name: "Открыть", exact: true });
    await mobileReveal.click({ trial: true });
    expect((await mobileReveal.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await mobileReveal.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest("button") === element;
    })).toBe(true);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.screenshot({ path: "test-results/host-mobile-ui.png", fullPage: true });
    await page.screenshot({ path: "test-results/host-mobile-viewport-ui.png", fullPage: false });
    await page.setViewportSize({ width: 1280, height: 900 });
    await board.screenshot({ path: "test-results/board-light-ui.png", fullPage: true });

    for (let index = 1; index < 6; index++)
      await page.locator(".host-answer").nth(index).getByRole("button", { name: "Открыть", exact: true }).click();
    await expect(board.locator(".statistics-answer-list > li")).toHaveCount(8);
    const beforeView = await (await page.request.get(`/api/games/${game.id}/host`)).json() as HostGame;
    await page.getByRole("button", { name: "Облако на табло", exact: true }).click();
    await expect(board.locator(".statistics-answer-cloud > li")).toHaveCount(8);
    await page.getByRole("button", { name: "Список на табло", exact: true }).click();
    await expect(board.locator(".statistics-answer-list > li")).toHaveCount(8);
    // A host's explicit choice also overrides a guest's local visualization,
    // even when that choice repeats the server's current preference.
    await board.getByRole("button", { name: "Облако ответов", exact: true }).click();
    await expect(board.locator(".statistics-answer-cloud > li")).toHaveCount(8);
    await page.getByRole("button", { name: "Список на табло", exact: true }).click();
    await expect(board.locator(".statistics-answer-list > li")).toHaveCount(8);
    const afterView = await (await page.request.get(`/api/games/${game.id}/host`)).json() as HostGame;
    expect(afterView.teams.map((team) => team.score)).toEqual(beforeView.teams.map((team) => team.score));
    expect(afterView.brand).toEqual(defaultBrand);
    expect(settingsWrites).toEqual([]);
    await expect(board.locator("body")).not.toContainText("Приватный исходный текст");
    expect(pageErrors).toEqual([]);
  } finally {
    await guestContext.close();
  }
});

test("a full survey keeps only its top six on the board and publishes every reviewed phrase in the list and cloud", async ({
  browser,
  page,
  baseURL,
}) => {
  const contexts: BrowserContext[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const original = "Приватная исходная фраза из анкеты";
  const publicLabel = "Подпись для общего экрана";
  const futurePrompt = "Несыгранный вопрос остаётся закрытым";
  const futureAnswer = "Несыгранный ответ остаётся закрытым";
  const rare = ["Единичный вариант Янтарь", "Редкий вариант Сирень", "Редкий вариант Клевер"];
  const question: Question = {
    id: randomUUID(),
    prompt: "Какие ответы останутся в общей картине опроса?",
    answers: Array.from({ length: 9 }, (_, index) => ({
      id: randomUUID(),
      text: index < 6 ? `Популярный вариант ${index + 1}` : rare[index - 6]!,
      points: 9 - index,
      aliases: [],
      ...(index === 0 ? { originals: [original] } : {}),
    })),
    source: "Учебная выгрузка для проверки полной статистики",
    surveyDate: "2026-10-15",
    respondentCount: 45,
    notes: "Приватная заметка: в опросе девять групп, на табло шесть.",
    isDemo: true,
    pack: "Полная палитра",
  };
  const futureQuestion: Question = {
    ...question,
    id: randomUUID(),
    prompt: futurePrompt,
    answers: [{ id: randomUUID(), text: futureAnswer, points: 1, aliases: [] }],
  };
  try {
    const setup = await page.request.post("/api/setup", {
      data: {
        token: await issueSetupToken(pool),
        username: "organizer",
        password: PASSWORD,
        brand: defaultBrand,
      },
    });
    expect(setup.ok()).toBe(true);
    await page.goto("/admin/questions/import");
    await page.getByLabel("Готовый JSON", { exact: true }).fill(JSON.stringify({
      format: "ctokodnomy-questions-v1",
      questions: [question, futureQuestion],
    }));
    await page.getByRole("button", { name: "Проверить вопросы", exact: true }).click();
    const preview = page.getByRole("region", { name: "Предпросмотр вопросов", exact: true });
    await expect(preview).toContainText("Табло: 6 · Все варианты: 9");
    const firstPreview = preview.locator(".question-import-question").first();
    await expect(firstPreview.locator(".question-import-answer-scope.on-board")).toHaveCount(6);
    await expect(firstPreview.getByText("Статистика", { exact: true })).toHaveCount(3);
    await page.getByRole("button", { name: "Сохранить вопросы", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Сохранено вопросов: 2.");

    // A reviewed public label can change without losing the original wording.
    await page.goto(`/admin/questions/${question.id}`);
    await expect(page.locator(".answer-editor-row")).toHaveCount(9);
    await expect(page.getByText("Только статистика", { exact: true })).toHaveCount(3);
    await page.locator(".answer-originals summary").click();
    await expect(page.locator(".answer-originals")).toContainText(original);
    await page.getByLabel("Ответ", { exact: true }).first().fill(publicLabel);
    await page.getByRole("button", { name: "Сохранить вопрос", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/questions$/);
    const library = await (await page.request.get("/api/questions")).json() as Question[];
    expect(library.find((item) => item.id === question.id)!.answers[0]).toMatchObject({
      text: publicLabel,
      originals: [original],
    });

    const created = await page.request.post("/api/games", {
      data: {
        title: "Девять ответов, шесть на табло",
        questionIds: [question.id, futureQuestion.id],
        teams: [{ name: "Первая команда", color: "#1646a0" }, { name: "Вторая команда", color: "#edff7a" }],
      },
    });
    expect(created.ok()).toBe(true);
    const game = await created.json() as HostGame;
    const guestContext = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    const phoneContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    contexts.push(guestContext, phoneContext);
    expect((await phoneContext.request.post("/api/join", { data: { code: game.teams[0]!.joinCode, name: "Участник опроса" } })).ok()).toBe(true);
    const board = await guestContext.newPage();
    const phone = await phoneContext.newPage();
    for (const screen of [board, phone])
      screen.on("pageerror", (error) => pageErrors.push(error.message));
    await board.goto(`/board/${game.id}`);
    await phone.goto(`/team/${game.id}`);
    await page.goto(`/host/${game.id}`);
    await page.getByRole("button", { name: "Начать игру", exact: true }).click();
    await expect(board.getByRole("heading", { name: question.prompt, exact: true })).toBeVisible();
    await expect(board.locator(".board-answer.closed")).toHaveCount(6);
    await expect(page.locator(".host-answer")).toHaveCount(6);
    const publicState = await (await guestContext.request.get(`/api/games/${game.id}/public`)).json() as PublicGame;
    expect(publicState.answers).toHaveLength(6);
    expect(publicState.roundStats).toBeNull();
    const teamState = await (await phoneContext.request.get(`/api/games/${game.id}/team`)).json();
    expect(teamState.answers).toHaveLength(6);
    for (const hidden of [...rare, original, publicLabel, futurePrompt, futureAnswer]) {
      expect(JSON.stringify(publicState)).not.toContain(hidden);
      expect(JSON.stringify(teamState)).not.toContain(hidden);
      await expect(board.locator("body")).not.toContainText(hidden);
      await expect(phone.locator("body")).not.toContainText(hidden);
    }

    // Opening six answers must finish the round even though three survey groups remain.
    for (let index = 0; index < 6; index++) {
      const row = page.locator(".host-answer").nth(index);
      await row.getByRole("button", { name: "Открыть", exact: true }).click();
      if (index < 5)
        await expect(row.getByRole("button", { name: "Открыт", exact: true })).toBeDisabled();
    }
    await expect(board.locator(".board-round-complete")).toBeVisible();
    const stats = board.locator(".round-statistics");
    await expect(stats).toContainText("Угадали 6 из 6");
    await expect(stats.locator(".statistics-answer-list > li")).toHaveCount(9);
    for (const answer of [...rare, publicLabel]) await expect(stats).toContainText(answer);
    await expect(stats).not.toContainText(original);
    await expect(board.locator("body")).not.toContainText(futurePrompt);
    const completed = await (await guestContext.request.get(`/api/games/${game.id}/public`)).json() as PublicGame;
    expect(completed.roundStats!.answers).toHaveLength(9);
    expect(completed.roundStats!.answers.filter((answer) => answer.onBoard)).toHaveLength(6);
    expect(completed.roundStats!.totalPoints).toBe(45);
    expect(JSON.stringify(completed)).not.toContain(original);

    await stats.getByRole("button", { name: "Облако ответов", exact: true }).click();
    await expect(stats.getByRole("button", { name: "Облако ответов", exact: true })).toHaveAttribute("aria-pressed", "true");
    const cloud = stats.getByRole("list", { name: "Облако всех ответов опроса", exact: true });
    await expect(cloud.getByRole("listitem")).toHaveCount(9);
    for (const answer of rare) await expect(cloud).toContainText(answer);
    await mkdir(path.resolve("test-results"), { recursive: true });
    await board.screenshot({ path: "test-results/survey-cloud-desktop.png", fullPage: true });
    await board.setViewportSize({ width: 1280, height: 720 });
    await board.getByRole("button", { name: "Для проектора", exact: true }).click();
    expect(await board.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
    await expect(stats.getByRole("button", { name: "Облако ответов", exact: true })).toBeInViewport();
    await expect(board.locator(".team-score").first()).toBeInViewport();
    const cloudViewport = stats.locator(".statistics-visualization");
    await cloudViewport.evaluate((element) => { element.scrollTop = 0; });
    expect(await cloudViewport.evaluate((element) => element.scrollTop)).toBe(0);
    await expectFullyUnclipped(cloud.getByRole("button").first());
    await board.screenshot({ path: "test-results/survey-cloud-projector.png", fullPage: true });
    await cloud.getByRole("button").last().focus();
    await expectFullyUnclipped(cloud.getByRole("button").last());
    for (const width of [320, 390]) {
      await board.setViewportSize({ width, height: 844 });
      expect(await board.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await expect(cloud.getByRole("listitem")).toHaveCount(9);
    }
    await board.screenshot({ path: "test-results/survey-cloud-mobile.png", fullPage: true });
    await stats.getByRole("button", { name: "Список", exact: true }).click();
    await expect(stats.locator(".statistics-answer-list > li")).toHaveCount(9);

    async function command(command: HostCommand) {
      const state = await (await page.request.get(`/api/games/${game.id}/host`)).json() as HostGame;
      const response = await page.request.post(`/api/games/${game.id}/commands`, {
        data: { command, revision: state.revision, requestId: randomUUID() },
      });
      expect(response.ok()).toBe(true);
      return response.json() as Promise<HostGame>;
    }
    const finished = await command({ type: "finish" });
    expect((await page.request.post(`/api/games/${game.id}/results/publication`, {
      data: { published: true, revision: finished.revision },
    })).ok()).toBe(true);
    await board.goto(`/results/${game.id}`);
    await expect(board.getByRole("heading", { name: "Итоги игры", exact: true })).toBeVisible();
    await expect(board.locator(".round-statistics")).toHaveCount(1);
    const reportResponse = await guestContext.request.get(`/api/games/${game.id}/results`);
    expect(reportResponse.ok()).toBe(true);
    const report = await reportResponse.json() as PublicGameResults;
    expect(report.rounds).toHaveLength(1);
    expect(report.rounds[0]!.answers).toHaveLength(9);
    for (const hidden of [original, futurePrompt, futureAnswer, question.notes]) {
      expect(JSON.stringify(report)).not.toContain(hidden);
      await expect(board.locator("body")).not.toContainText(hidden);
    }
    await board.getByRole("button", { name: "Облако ответов", exact: true }).click();
    await expect(board.locator(".statistics-answer-cloud > li")).toHaveCount(9);
    for (const answer of rare) await expect(board.locator(".statistics-answer-cloud")).toContainText(answer);
    expect(pageErrors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
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
    await expect(page.locator(".host-status-bar .host-bank > strong")).toHaveText(
      String(firstAnswer.points),
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
    await page.getByRole("button", { name: "Ход и банк", exact: true }).click();
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

// Every mutation below uses the real API and a fresh revision. The UI checks
// therefore cover live updates rather than a static screenshot of fixtures.
async function hostDecision(page: Page, id: string, command: HostCommand): Promise<HostGame> {
  const current = await page.request.get(`/api/games/${id}/host`);
  expect(current.ok()).toBe(true);
  const state = await current.json() as HostGame;
  const response = await page.request.post(`/api/games/${id}/commands`, {
    data: { command, revision: state.revision, requestId: randomUUID() },
  });
  expect(response.ok()).toBe(true);
  return response.json() as Promise<HostGame>;
}

async function createFixtureGame(page: Page, questions: Question[], title: string): Promise<HostGame> {
  expect((await page.request.post("/api/questions/import", {
    data: { format: "ctokodnomy-questions-v1", questions },
  })).ok()).toBe(true);
  const response = await page.request.post("/api/games", { data: {
    title, questionIds: questions.map((question) => question.id),
    teams: [{ name: "Исследователи", color: "#1646a0" }, { name: "Аналитики", color: "#8146c3" }],
    rules: { multipliers: questions.map(() => 1), stealAddsPoints: true },
  } });
  expect(response.ok()).toBe(true);
  return response.json() as Promise<HostGame>;
}

function sixAnswerFixture(): Question {
  return {
    ...packFixture("Что помогает команде найти ответ?", "Проверка пульта"),
    answers: ["Обсуждение", "Опыт", "Дружба", "Внимание", "Юмор", "Удача"].map((text, index) => ({
      id: randomUUID(), text, points: 6 - index, aliases: [],
    })),
    respondentCount: 21,
  };
}

async function expectFullBoundsAbove(locator: Locator, bottom: number, height: number) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const geometry = `Element ${JSON.stringify(box)}, viewport ${JSON.stringify(locator.page().viewportSize())}, lower boundary ${bottom}`;
  expect(box!.y, geometry).toBeGreaterThanOrEqual(-1);
  expect(box!.y + box!.height, geometry).toBeLessThanOrEqual(Math.min(bottom, height) + 1);
}

async function expectFullyUnclipped(locator: Locator) {
  await expect.poll(() => locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const bounds = parent.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
        left = Math.max(left, bounds.left + parent.clientLeft);
        right = Math.min(right, bounds.left + parent.clientLeft + parent.clientWidth);
      }
      if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
        top = Math.max(top, bounds.top + parent.clientTop);
        bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight);
      }
    }
    return box.left >= left - 1 && box.top >= top - 1 && box.right <= right + 1 && box.bottom <= bottom + 1;
  })).toBe(true);
}

test("the host sees six complete answers and floating actions together, with safe pause, undo and phone focus", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await seedOrganizer(page);
  const question = sixAnswerFixture();
  const game = await createFixtureGame(page, [question], "Пульт без лишнего скролла");
  await hostDecision(page, game.id, { type: "start", teamId: game.teams[0]!.id });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/host/${game.id}`);
  const dock = page.getByRole("region", { name: "Быстрые действия ведущего", exact: true });
  const strike = dock.getByRole("button", { name: "Отметить ошибку", exact: true });
  const rows = page.locator(".host-answer");
  await expect(rows).toHaveCount(6);
  await expect(strike).toBeEnabled();
  async function desktopGeometry(width: number, height: number) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect(dock).toBeInViewport();
    const island = (await dock.boundingBox())!;
    expect(island.y + island.height).toBeLessThanOrEqual(height + 1);
    for (const row of await rows.all()) await expectFullBoundsAbove(row, island.y, height);
    await expectFullBoundsAbove(strike, height, height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1366, height: 768 }]) {
    await desktopGeometry(viewport.width, viewport.height);
  }
  await rows.first().getByRole("button", { name: "Открыть", exact: true }).click();
  await expect(rows.first().getByRole("button", { name: "Открыт", exact: true })).toBeDisabled();
  await strike.click();
  await expect(dock).toContainText("Решение сохранено");
  expect(((await (await page.request.get(`/api/games/${game.id}/host`)).json()) as HostGame).strikes).toBe(1);
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1366, height: 768 }]) {
    await desktopGeometry(viewport.width, viewport.height);
  }
  await mkdir(path.resolve("test-results"), { recursive: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: "test-results/host-floating-dock-1280x720.png" });
  await dock.getByRole("button", { name: "Пауза", exact: true }).click();
  await expect(dock.getByRole("button", { name: "Продолжить игру", exact: true })).toBeEnabled();
  await expect(strike).toBeDisabled();
  for (const reveal of await rows.getByRole("button", { name: "Открыть", exact: true }).all()) await expect(reveal).toBeDisabled();
  await dock.getByRole("button", { name: "Продолжить игру", exact: true }).click();
  await dock.getByRole("button", { name: "Отменить последнее", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Подтвердите решение", exact: true });
  await expect(confirmation).toBeVisible();
  const beforeCancel = await (await page.request.get(`/api/games/${game.id}/host`)).json() as HostGame;
  await confirmation.getByRole("button", { name: "Отмена", exact: true }).click();
  expect(((await (await page.request.get(`/api/games/${game.id}/host`)).json()) as HostGame).revision).toBe(beforeCancel.revision);
  await dock.getByRole("button", { name: "Отменить последнее", exact: true }).click();
  await confirmation.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  // Undoing resume restores pause; the floating action must immediately agree.
  await expect(dock.getByRole("button", { name: "Продолжить игру", exact: true })).toBeEnabled();
  await dock.getByRole("button", { name: "Продолжить игру", exact: true }).click();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const lastReveal = rows.last().getByRole("button", { name: "Открыть", exact: true });
    await lastReveal.focus();
    await expect(lastReveal).toBeFocused();
    await lastReveal.click({ trial: true });
    const island = (await dock.boundingBox())!;
    await expectFullBoundsAbove(lastReveal, island.y, 844);
    await expectFullBoundsAbove(rows.last(), island.y, 844);
    for (const button of await dock.getByRole("button").all()) {
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect((await lastReveal.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `test-results/host-floating-dock-mobile-${width}.png` });
  }
  await hostDecision(page, game.id, { type: "strike" });
  await hostDecision(page, game.id, { type: "strike" });
  await expect(dock.getByRole("button", { name: "Перехват не удался", exact: true })).toBeEnabled();
  await expect(dock.getByRole("button", { name: "Отметить ошибку", exact: true })).toHaveCount(0);
  await dock.getByRole("button", { name: "Ход и банк", exact: true }).click();
  const teamActions = page.getByRole("region", { name: "Ход и банк", exact: true });
  for (const transfer of await teamActions.getByRole("button", { name: "Передать ход", exact: true }).all()) await expect(transfer).toBeDisabled();
  await teamActions.getByRole("button", { name: "Закрыть действия с командами", exact: true }).click();
  expect(pageErrors).toEqual([]);
});

test("published analytics distinguish banks from corrections and keep cloud percentages stable under filters", async ({ browser, page, baseURL }) => {
  const pageErrors: string[] = [];
  await seedOrganizer(page);
  const privateText = "Приватный исходник аналитики";
  const longPhrase = "Очень длинная формулировка ответа о дружеском обсуждении и совместном поиске неожиданного решения";
  const first: Question = {
    ...packFixture("Что помогает решать задачи вместе?", "Аналитика"),
    answers: [20, 10, 5, 3, 1, 1, 1, 0].map((points, index) => ({
      id: randomUUID(), text: index === 0 ? longPhrase : index === 6 ? "Редкая идея" : index === 7 ? "Нулевой вариант" : `Ответ аналитики ${index + 1}`,
      points, aliases: [], ...(index === 0 ? { originals: [privateText] } : {}),
    })), respondentCount: 41,
  };
  const second = { ...packFixture("Что делает встречу приятной?"), answers: [{ id: randomUUID(), text: "Общение", points: 10, aliases: [] }] };
  const future = { ...packFixture("Закрытый будущий вопрос"), answers: [{ id: randomUUID(), text: "Секрет будущего раунда", points: 1, aliases: [] }] };
  const game = await createFixtureGame(page, [first, second, future], "Банк и итоговый счёт");
  await hostDecision(page, game.id, { type: "start", teamId: game.teams[0]!.id });
  for (const answer of first.answers.slice(0, 6)) await hostDecision(page, game.id, { type: "reveal", answerId: answer.id });
  await hostDecision(page, game.id, { type: "next", teamId: game.teams[1]!.id });
  await hostDecision(page, game.id, { type: "reveal", answerId: second.answers[0]!.id });
  await hostDecision(page, game.id, { type: "adjust", teamId: game.teams[0]!.id, delta: 7, reason: "Учебная корректировка" });
  const finished = await hostDecision(page, game.id, { type: "finish" });
  expect(finished.teams.map((team) => team.score)).toEqual([47, 10]);
  expect((await page.request.post(`/api/games/${game.id}/results/publication`, {
    data: { published: true, revision: finished.revision },
  })).ok()).toBe(true);
  const guest = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
  try {
    const results = await guest.newPage();
    results.on("pageerror", (error) => pageErrors.push(error.message));
    await results.goto(`/results/${game.id}`);
    const report = await (await guest.request.get(`/api/games/${game.id}/results`)).json() as PublicGameResults;
    expect(report.rounds).toHaveLength(2);
    expect(report.totalRounds).toBe(3);
    for (const hidden of [privateText, first.notes, future.prompt, future.answers[0]!.text]) {
      expect(JSON.stringify(report)).not.toContain(hidden);
      await expect(results.locator("body")).not.toContainText(hidden);
    }
    const teams = results.getByRole("region", { name: "Команды в цифрах", exact: true });
    await expect(teams).toBeVisible();
    const firstTeam = teams.locator(`.results-team-analytics[data-team-id="${game.teams[0]!.id}"]`);
    await expect(firstTeam).toContainText("47");
    await expect(firstTeam).toContainText("40");
    await expect(firstTeam).toContainText("+7");
    const dynamics = results.getByRole("region", { name: "Как менялись очки", exact: true });
    await expect(dynamics).toBeVisible();
    const table = dynamics.getByRole("table", { name: "Накопленные очки из банка по раундам", exact: true });
    await expect(table.getByRole("row").filter({ hasText: "Раунд 1" })).toContainText("40");
    await expect(table.getByRole("row").filter({ hasText: "Раунд 2" })).toContainText("10");
    const firstStats = results.locator(".round-statistics").first();
    await firstStats.getByRole("button", { name: "Облако ответов", exact: true }).click();
    const cloud = firstStats.getByRole("list", { name: "Облако всех ответов опроса", exact: true });
    await expect(cloud.getByRole("listitem")).toHaveCount(8);
    const tag = firstStats.getByRole("button", { name: `Подробнее об ответе: ${longPhrase}`, exact: true });
    await tag.click();
    const detail = firstStats.getByRole("region", { name: "Подробности ответа", exact: true });
    await expect(detail).toContainText("48,8%");
    await expect(detail).toContainText("Вес: 20");
    await detail.getByRole("button", { name: "Закрыть подробности", exact: true }).click();
    await expect(detail).toHaveCount(0);
    await firstStats.getByLabel("Поиск по ответам", { exact: true }).fill("дружеском");
    await expect(cloud.getByRole("listitem")).toHaveCount(1);
    await tag.click();
    await expect(detail).toContainText("48,8%");
    await firstStats.getByLabel("Поиск по ответам", { exact: true }).clear();
    const filter = firstStats.getByLabel("Фильтр ответов", { exact: true });
    await filter.selectOption("outside");
    await expect(cloud.getByRole("listitem")).toHaveCount(2);
    await firstStats.getByRole("button", { name: "Подробнее об ответе: Нулевой вариант", exact: true }).click();
    await expect(detail).toContainText("Вес: 0");
    await expect(detail).toContainText("Доля: 0%");
    await filter.selectOption("board");
    await expect(cloud.getByRole("listitem")).toHaveCount(6);
    await filter.selectOption("opened");
    await expect(cloud.getByRole("listitem")).toHaveCount(6);
    await filter.selectOption("all");
    await expect(cloud.getByRole("listitem")).toHaveCount(8);
    await results.screenshot({ path: "test-results/results-analytics-cloud-desktop.png", fullPage: true });
    await results.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await results.screenshot({ path: "test-results/results-analytics-desktop-viewport.png" });
    for (const width of [320, 390]) {
      await results.setViewportSize({ width, height: 844 });
      expect(await results.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await tag.click();
      expect((await tag.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expect(detail).toContainText(longPhrase);
      await detail.getByRole("button", { name: "Закрыть подробности", exact: true }).click();
      await cloud.evaluate((element) => { element.scrollTop = 0; });
      await tag.focus();
      await expectFullyUnclipped(tag);
      await results.screenshot({ path: `test-results/results-answer-cloud-mobile-${width}-first.png` });
      await cloud.getByRole("button").last().focus();
      await expectFullyUnclipped(cloud.getByRole("button").last());
      await results.screenshot({ path: `test-results/results-answer-cloud-mobile-${width}-last.png` });
      await results.screenshot({ path: `test-results/results-analytics-cloud-mobile-${width}.png`, fullPage: true });
    }
    expect(pageErrors).toEqual([]);
  } finally { await guest.close(); }
});

test("independent phones group private team ideas, search authors and send only a captain's explicit answer", async ({ browser, page, baseURL }) => {
  const contexts: BrowserContext[] = [];
  const pageErrors: string[] = [];
  await seedOrganizer(page);
  const game = await createFixtureGame(page, [sixAnswerFixture()], "Командная мастерская");
  async function phone(teamIndex: number, name: string) {
    const context = await browser.newContext({ baseURL, viewport: { width: 320, height: 844 }, isMobile: true, hasTouch: true });
    contexts.push(context);
    expect((await context.request.post("/api/join", { data: { code: game.teams[teamIndex]!.joinCode, name } })).ok()).toBe(true);
    const screen = await context.newPage();
    screen.on("pageerror", (error) => pageErrors.push(error.message));
    await screen.goto(`/team/${game.id}`);
    await expect(screen.getByText("На связи", { exact: true })).toBeVisible();
    return screen;
  }
  try {
    const captain = await phone(0, "Мария капитан");
    const member = await phone(0, "Алексей игрок");
    const rival = await phone(1, "Ольга соперник");
    // Joining alone never grants captain privileges; the host appoints one.
    const captainState = await (await captain.request.get(`/api/games/${game.id}/team`)).json();
    expect((await page.request.post(`/api/games/${game.id}/captain`, {
      data: { participantId: captainState.self.id },
    })).ok()).toBe(true);
    await expect(captain.getByLabel("Итоговый ответ", { exact: true })).toBeVisible();
    const officialRequests: string[] = [];
    captain.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/submit")) officialRequests.push(request.url());
    });
    await hostDecision(page, game.id, { type: "start", teamId: game.teams[0]!.id });
    async function suggest(screen: Page, text: string) {
      const input = screen.getByLabel("Ваше предложение", { exact: true });
      await input.fill(text);
      const sent = screen.waitForResponse((response) => response.url().endsWith("/suggest") && response.request().method() === "POST");
      await screen.getByRole("button", { name: "Предложить ответ", exact: true }).click();
      expect((await sent).ok()).toBe(true);
      await expect(input).toHaveValue("");
    }
    await suggest(captain, "Обсудить вместе");
    await expect(member.locator(".team-ideas .suggestion-list")).toContainText("Обсудить вместе");
    await suggest(member, "Обсудить вместе");
    await suggest(member, "Обсудить вместе");
    await suggest(member, "Неожиданная новая идея");
    const ideas = captain.locator(".team-ideas .suggestion-list > li");
    await expect(ideas).toHaveCount(2);
    await expect(ideas.first()).toContainText("Неожиданная новая идея");
    const duplicate = ideas.filter({ hasText: "Обсудить вместе" });
    await expect(duplicate).toContainText("Мария капитан");
    await expect(duplicate).toContainText("Алексей игрок");
    await expect(duplicate.locator("summary")).toContainText("3");
    await duplicate.locator("summary").click();
    await expect(duplicate.locator("details")).toHaveJSProperty("open", true);
    await captain.getByRole("combobox", { name: /^Порядок идей/ }).selectOption({ label: "Сначала частые" });
    await expect(ideas.first()).toContainText("Обсудить вместе");
    const search = captain.getByLabel("Поиск идей команды", { exact: true });
    await search.fill("Мария");
    await expect(ideas).toHaveCount(1);
    await expect(ideas).toContainText("Обсудить вместе");
    await search.fill("новая идея");
    await expect(ideas).toHaveCount(1);
    await expect(ideas).toContainText("Неожиданная новая идея");
    await captain.getByRole("button", { name: "Очистить поиск идей", exact: true }).click();
    await expect(ideas).toHaveCount(2);
    await duplicate.getByRole("button", { name: "Выбрать", exact: true }).click();
    const answer = captain.getByLabel("Итоговый ответ", { exact: true });
    await expect(answer).toHaveValue("Обсудить вместе");
    expect(officialRequests).toEqual([]);
    const current = await (await page.request.get(`/api/games/${game.id}/host`)).json() as HostGame;
    expect(current.pendingAnswer).toBeNull();
    const rivalState = await (await rival.request.get(`/api/games/${game.id}/team`)).json();
    expect(rivalState.suggestions).toEqual([]);
    for (const hidden of ["Обсудить вместе", "Неожиданная новая идея", "Мария капитан", "Алексей игрок"]) {
      expect(JSON.stringify(rivalState)).not.toContain(hidden);
      await expect(rival.locator("body")).not.toContainText(hidden);
    }
    await expect(member.getByRole("button", { name: "Выбрать", exact: true })).toHaveCount(0);
    await expect(member.getByLabel("Итоговый ответ", { exact: true })).toHaveCount(0);
    const submit = captain.getByRole("button", { name: "Отправить ответ ведущему", exact: true });
    await hostDecision(page, game.id, { type: "pause" });
    await expect(submit).toBeDisabled();
    await expect(captain.getByRole("button", { name: "Предложить ответ", exact: true })).toBeDisabled();
    await expect(answer).toHaveValue("Обсудить вместе");
    await hostDecision(page, game.id, { type: "resume" });
    await expect(submit).toBeEnabled();
    await captain.screenshot({ path: "test-results/team-ideas-mobile.png", fullPage: true });
    await hostDecision(page, game.id, { type: "turn", teamId: game.teams[1]!.id });
    await expect(submit).toBeDisabled();
    await expect(ideas).toHaveCount(0);
    await hostDecision(page, game.id, { type: "turn", teamId: game.teams[0]!.id });
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(captain.locator(".pending-team-answer")).toContainText("Обсудить вместе");
    await expect(member.locator(".pending-team-answer")).toContainText("Обсудить вместе");
    expect(officialRequests).toHaveLength(1);
    const pending = await (await page.request.get(`/api/games/${game.id}/host`)).json() as HostGame;
    expect(pending.pendingAnswer?.text).toBe("Обсудить вместе");
    const finalRivalState = await (await rival.request.get(`/api/games/${game.id}/team`)).json();
    expect(finalRivalState.pendingAnswer).toBeNull();
    expect(finalRivalState.suggestions).toEqual([]);
    expect(JSON.stringify(finalRivalState)).not.toContain("Обсудить вместе");
    await expect(rival.locator("body")).not.toContainText("Обсудить вместе");
    for (const screen of [captain, member, rival]) {
      expect(await screen.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    expect(pageErrors).toEqual([]);
  } finally { await Promise.all(contexts.map((context) => context.close())); }
});
