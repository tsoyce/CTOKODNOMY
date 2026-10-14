import { mkdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import {
  expect,
  test,
  type BrowserContext,
  type Locator,
} from "@playwright/test";
import { issueSetupToken } from "../server/db";
import type { HostGame } from "../shared/types";

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
const PASSWORD = "Browser-testing-only!12345";

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
    await page.goto("/setup");
    await fillSecret(page.getByLabel("Код первого запуска"), grant);
    await page.getByLabel("Логин организатора").fill("organizer");
    await fillSecret(page.getByLabel(/^Пароль/), PASSWORD);
    await fillSecret(page.getByLabel("Повторите пароль"), PASSWORD);
    await page.getByRole("button", { name: "Далее: мероприятие" }).click();
    await page
      .getByLabel("Название игры", { exact: true })
      .fill("Социологи знают");
    await page
      .getByLabel("Организатор", { exact: true })
      .fill("День социолога");
    await page
      .getByRole("button", { name: "Предпросмотр", exact: true })
      .click();
    await page.getByRole("button", { name: "Завершить настройку" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(
      page.getByRole("heading", { name: "Добро пожаловать, организатор" }),
    ).toBeVisible();

    await page.goto("/setup");
    await expect(
      page.getByRole("heading", { name: "Всё уже настроено" }),
    ).toBeVisible();
    await page.goto("/admin/settings");
    await page
      .getByLabel("Описание", { exact: true })
      .fill("Вечер идей, команд и неожиданных ответов.");
    await page.getByRole("button", { name: "Сохранить оформление" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Оформление сохранено" }),
    ).toBeVisible();
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
      .fill("День социолога · репетиция");
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
    await expect(board.locator(".board-brand")).toContainText(
      "Социологи знают",
    );
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
    expect(pageErrors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
