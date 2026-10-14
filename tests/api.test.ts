import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildApp } from "../server/app";
import { issueSetupToken, tokenHash } from "../server/db";
import {
  defaultBrand,
  type Brand,
  type HostCommand,
  type HostGame,
  type Participant,
  type Question,
  type TeamGame,
} from "../shared/types";

const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "x";
const databaseUrl = process.env.DATABASE_URL_TEST;
if (
  !databaseUrl ||
  !decodeURIComponent(new URL(databaseUrl).pathname).endsWith("_test")
) {
  throw new Error(
    "API integration tests require DATABASE_URL_TEST pointing to a dedicated database with a name ending in _test.",
  );
}

describe("real PostgreSQL API: installation, access boundaries and durable gameplay", () => {
  let app: FastifyInstance;
  let pool: pg.Pool;
  let controlPool: pg.Pool;
  let schema: string;
  let mediaDir: string;

  beforeEach(async () => {
    schema = `api_${randomUUID().replaceAll("-", "")}`;
    controlPool = new pg.Pool({ connectionString: databaseUrl });
    await controlPool.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema}`,
    });
    mediaDir = await mkdtemp(path.join(tmpdir(), "ctok-api-"));
    app = await buildApp({ pool, mediaDir, publicOrigin: ORIGIN });
    await app.ready();
  });

  afterEach(async () => {
    await app?.close();
    await pool?.end();
    if (controlPool) {
      if (schema)
        await controlPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await controlPool.end();
    }
    if (mediaDir) await rm(mediaDir, { recursive: true, force: true });
  });

  const call = (
    method: "GET" | "POST" | "PUT" | "DELETE",
    url: string,
    payload?: unknown,
    cookie?: string,
    origin = ORIGIN,
  ) =>
    app.inject({
      method,
      url: `/api${url}`,
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
      headers: {
        origin,
        ...(payload === undefined
          ? {}
          : { "content-type": "application/json" }),
        ...(cookie ? { cookie } : {}),
      },
    });
  const readCookie = (headers: Record<string, unknown>) => {
    const value = headers["set-cookie"];
    const cookies = Array.isArray(value) ? value : [value];
    return cookies
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.split(";")[0])
      .join("; ");
  };
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ1sAAAAASUVORK5CYII=",
    "base64",
  );
  const upload = (
    data: Buffer,
    mime: string,
    filename: string,
    headers: Record<string, string> = {},
    url = "/api/media",
  ) => {
    const boundary = "ctok-test-upload-boundary";
    return app.inject({
      method: "POST",
      url,
      headers: {
        origin: ORIGIN,
        "content-type": `multipart/form-data; boundary=${boundary}`,
        ...headers,
      },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
        ),
        data,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
  };
  async function initialize() {
    const token = await issueSetupToken(pool);
    const response = await call("POST", "/setup", {
      token,
      username: "organizer",
      password: PASSWORD,
      brand: defaultBrand,
    });
    expect(response.statusCode).toBe(200);
    return readCookie(response.headers);
  }
  function question(prompt: string, first: string, second: string): Question {
    return {
      id: randomUUID(),
      prompt,
      answers: [
        {
          id: randomUUID(),
          text: first,
          points: 60,
          aliases: ["private-alias"],
        },
        { id: randomUUID(), text: second, points: 40, aliases: [] },
      ],
      source: "private-survey-source",
      surveyDate: "",
      respondentCount: null,
      notes: "private-organizer-notes",
      isDemo: true,
      pack: "Тест",
    };
  }
  async function createFixture(adminCookie: string) {
    const questions = [
      question(
        "Что помогает социологу?",
        "Секретный ответ А",
        "Секретный ответ Б",
      ),
      question("Будущий скрытый вопрос", "Будущий ответ А", "Будущий ответ Б"),
    ];
    const imported = await call(
      "POST",
      "/questions/import",
      { format: "ctokodnomy-questions-v1", questions },
      adminCookie,
    );
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toEqual({ count: 2 });
    const created = await call(
      "POST",
      "/games",
      {
        title: "День социолога",
        questionIds: questions.map((q) => q.id),
        teams: [
          { name: "Исследователи", color: "#7559ff" },
          { name: "Аналитики", color: "#edff7a" },
        ],
      },
      adminCookie,
    );
    expect(created.statusCode).toBe(200);
    return { game: created.json<HostGame>(), questions };
  }
  async function join(code: string, name: string) {
    const response = await call("POST", "/join", { code, name });
    expect(response.statusCode).toBe(200);
    return {
      cookie: readCookie(response.headers),
      participant: response.json<{ participant: Participant }>().participant,
    };
  }
  async function hostCommand(
    state: HostGame,
    cookie: string,
    command: HostCommand,
    requestId = randomUUID(),
  ) {
    const response = await call(
      "POST",
      `/games/${state.id}/commands`,
      { command, revision: state.revision, requestId },
      cookie,
    );
    expect(response.statusCode, response.body).toBe(200);
    return response.json<HostGame>();
  }

  test("first-run grants expire, cannot be replayed, and credentials stay hashed and revocable", async () => {
    expect((await call("GET", "/site")).json().initialized).toBe(false);
    expect((await call("GET", "/settings")).statusCode).toBe(401);
    const setup = {
      username: "OrganizeR",
      password: PASSWORD,
      brand: defaultBrand,
    };
    expect(
      (
        await call("POST", "/setup", {
          ...setup,
          password: "",
          token: "a-token-that-never-existed",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call("POST", "/setup", {
          ...setup,
          token: "a-token-that-never-existed",
        })
      ).statusCode,
    ).toBe(403);
    const expired = await issueSetupToken(pool);
    await pool.query(
      "UPDATE setup_grants SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
      [tokenHash(expired)],
    );
    expect(
      (await call("POST", "/setup", { ...setup, token: expired })).statusCode,
    ).toBe(403);
    const token = await issueSetupToken(pool);
    const initialized = await call("POST", "/setup", { ...setup, token });
    expect(initialized.statusCode).toBe(200);
    expect(initialized.json().admin.username).toBe("organizer");
    const adminCookie = readCookie(initialized.headers);
    const cookieFlags = String(initialized.headers["set-cookie"])
      .split(";")
      .slice(1)
      .map((flag) => flag.trim());
    expect(cookieFlags).toContain("HttpOnly");
    expect(cookieFlags).toContain("SameSite=Lax");
    expect((await call("POST", "/setup", { ...setup, token })).statusCode).toBe(
      409,
    );
    const stored = await pool.query("SELECT password_hash FROM admins");
    expect(stored.rows[0].password_hash).toMatch(
      /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/,
    );
    expect(stored.rows[0].password_hash).not.toContain(PASSWORD);
    const grants = await pool.query(
      "SELECT token_hash,used_at FROM setup_grants",
    );
    expect(grants.rows[0].token_hash).toBe(tokenHash(token));
    expect(grants.rows[0].used_at).toBeTruthy();
    expect(
      (
        await call("POST", "/login", {
          username: "organizer",
          password: "",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call("POST", "/login", {
          username: "organizer",
          password: "incorrect",
        })
      ).statusCode,
    ).toBe(401);
    const loggedIn = await call("POST", "/login", {
      username: "organizer",
      password: PASSWORD,
    });
    expect(loggedIn.statusCode).toBe(200);
    const secondSession = readCookie(loggedIn.headers);
    expect(
      (
        await call(
          "PUT",
          "/settings",
          { ...defaultBrand, title: "Forged" },
          adminCookie,
          "https://unrelated.example",
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (await call("GET", "/settings", undefined, adminCookie)).json().title,
    ).toBe(defaultBrand.title);
    expect(
      (
        await call(
          "POST",
          "/account/password",
          { currentPassword: PASSWORD, newPassword: "" },
          adminCookie,
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call(
          "POST",
          "/account/password",
          { currentPassword: PASSWORD, newPassword: "x".repeat(129) },
          adminCookie,
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call(
          "POST",
          "/account/password",
          { currentPassword: "wrong", newPassword: "y" },
          adminCookie,
        )
      ).statusCode,
    ).toBe(400);
    const changed = await call(
      "POST",
      "/account/password",
      { currentPassword: PASSWORD, newPassword: "y" },
      adminCookie,
    );
    expect(changed.statusCode).toBe(200);
    expect(
      (await call("GET", "/settings", undefined, adminCookie)).statusCode,
    ).toBe(401);
    expect(
      (await call("GET", "/settings", undefined, secondSession)).statusCode,
    ).toBe(401);
    const replacementCookie = readCookie(changed.headers);
    expect(
      (await call("POST", "/logout", {}, replacementCookie)).statusCode,
    ).toBe(200);
    expect(
      (await call("GET", "/settings", undefined, replacementCookie)).statusCode,
    ).toBe(401);
    expect(
      (
        await call("POST", "/login", {
          username: "organizer",
          password: PASSWORD,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await call("POST", "/login", {
          username: "organizer",
          password: "y",
        })
      ).statusCode,
    ).toBe(200);
  });

  test("setup logo uploads require a live unused grant, preserve it for installation, and close after setup", async () => {
    const setupUpload = (token?: string, data = png, mime = "image/png") =>
      upload(
        data,
        mime,
        "logo.png",
        token ? { "x-setup-token": token } : {},
        "/api/setup/media",
      );
    expect((await setupUpload()).statusCode).toBe(403);
    expect((await setupUpload("a-token-that-never-existed")).statusCode).toBe(
      403,
    );
    const expired = await issueSetupToken(pool);
    await pool.query(
      "UPDATE setup_grants SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
      [tokenHash(expired)],
    );
    expect((await setupUpload(expired)).statusCode).toBe(403);
    const used = await issueSetupToken(pool);
    await pool.query(
      "UPDATE setup_grants SET used_at=now() WHERE token_hash=$1",
      [tokenHash(used)],
    );
    expect((await setupUpload(used)).statusCode).toBe(403);
    const token = await issueSetupToken(pool);
    expect(
      (await setupUpload(token, Buffer.from("not an image"))).statusCode,
    ).toBe(415);
    expect((await setupUpload(token, png, "image/jpeg")).statusCode).toBe(415);
    const saved = await setupUpload(token);
    expect(saved.statusCode).toBe(200);
    const logoUrl = saved.json<{ url: string }>().url;
    expect(logoUrl).toMatch(/^\/media\/[a-f0-9-]+\.png$/);
    expect(
      (await app.inject({ method: "GET", url: logoUrl })).rawPayload,
    ).toEqual(png);
    expect(
      (await pool.query("SELECT used_at FROM setup_grants")).rows[0].used_at,
    ).toBeNull();
    const initialized = await call("POST", "/setup", {
      token,
      username: "organizer",
      password: PASSWORD,
      brand: { ...defaultBrand, logoUrl },
    });
    expect(initialized.statusCode).toBe(200);
    expect((await call("GET", "/site")).json().brand.logoUrl).toBe(logoUrl);
    expect((await setupUpload(token)).statusCode).toBe(409);
    expect((await upload(png, "image/png", "logo.png")).statusCode).toBe(401);
  });

  test("older stored branding receives new text defaults without overwriting existing fields or game snapshots", async () => {
    const cookie = await initialize();
    const legacy: Partial<Brand> = {
      ...defaultBrand,
      title: "Выпускной",
      organizer: "",
      description: "",
    };
    delete legacy.heroTitle;
    delete legacy.heroNote;
    delete legacy.footerText;
    await pool.query("UPDATE app_settings SET brand=$1::jsonb WHERE id=1", [
      JSON.stringify(legacy),
    ]);
    const expected = { ...defaultBrand, ...legacy };
    expect((await call("GET", "/site")).json().brand).toEqual(expected);
    expect((await call("GET", "/settings", undefined, cookie)).json()).toEqual(
      expected,
    );
    // Reading must not rewrite a user's persisted settings as part of an upgrade.
    expect(
      (await pool.query("SELECT brand FROM app_settings")).rows[0].brand,
    ).toEqual(legacy);
    const { game } = await createFixture(cookie);
    expect(game.brand).toEqual(expected);
    const snapshot = { ...legacy, title: "Сохранённое оформление игры" };
    await pool.query(
      "UPDATE games SET state=jsonb_set(state - 'roundResults' - 'resultsPublished','{brand}',$2::jsonb) WHERE id=$1",
      [game.id, JSON.stringify(snapshot)],
    );
    const expectedSnapshot = { ...defaultBrand, ...snapshot };
    expect(
      (await call("GET", `/games/${game.id}/public`)).json().brand,
    ).toEqual(expectedSnapshot);
    expect(
      (await call("GET", `/games/${game.id}/host`, undefined, cookie)).json()
        .brand,
    ).toEqual(expectedSnapshot);
    const legacyGame = (
      await call("GET", `/games/${game.id}/host`, undefined, cookie)
    ).json<HostGame>();
    expect(legacyGame.roundResults).toEqual([]);
    expect(legacyGame.resultsPublished).toBe(false);
    expect((await call("GET", "/site")).json().games[0].resultsAvailable).toBe(
      false,
    );
    expect(
      (await pool.query("SELECT state FROM games WHERE id=$1", [game.id]))
        .rows[0].state,
    ).not.toHaveProperty("roundResults");
    const member = await join(game.teams[0]!.joinCode, "Игрок");
    expect(
      (
        await call("GET", `/games/${game.id}/team`, undefined, member.cookie)
      ).json().brand,
    ).toEqual(expectedSnapshot);
    expect(
      (await pool.query("SELECT state FROM games WHERE id=$1", [game.id]))
        .rows[0].state.roundResults,
    ).toEqual([]);
    expect((await call("PUT", "/settings", legacy, cookie)).json()).toEqual(
      expected,
    );
    expect(
      (
        await call(
          "PUT",
          "/settings",
          { ...expected, heroTitle: "", heroNote: "", footerText: "" },
          cookie,
        )
      ).json().heroTitle,
    ).toBe("");
  });

  test("question import validates the entire pack and existing games keep their content and brand snapshots", async () => {
    const cookie = await initialize();
    const { game, questions } = await createFixture(cookie);
    const malformed = {
      ...question("Не сохранять", "Первый", "Второй"),
      answers: [{ id: randomUUID(), text: "Ошибка", points: -1, aliases: [] }],
    };
    expect(
      (
        await call(
          "POST",
          "/questions/import",
          {
            format: "ctokodnomy-questions-v1",
            questions: [
              question("Валидный, но тоже не сохранять", "А", "Б"),
              malformed,
            ],
          },
          cookie,
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (await call("GET", "/questions", undefined, cookie)).json(),
    ).toHaveLength(2);
    expect(
      (await call("GET", "/questions/export", undefined, cookie)).json().format,
    ).toBe("ctokodnomy-questions-v1");
    expect((await call("POST", "/questions/demo", {})).statusCode).toBe(401);
    const demos = await call("POST", "/questions/demo", {}, cookie);
    expect(demos.statusCode).toBe(200);
    expect(demos.json()).toEqual({ count: 3 });
    const library = (await call("GET", "/questions", undefined, cookie)).json<
      Question[]
    >();
    expect(library).toHaveLength(5);
    const added = library.filter(
      (q) => !questions.some((original) => original.id === q.id),
    );
    expect(added).toHaveLength(3);
    for (const demo of added) {
      expect(demo.isDemo).toBe(true);
      expect(demo.source).toContain("Реальный опрос не проводился");
    }
    expect(
      (
        await call(
          "PUT",
          `/questions/${questions[0]!.id}`,
          { ...questions[0], prompt: "Новое содержание" },
          cookie,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call(
          "PUT",
          "/settings",
          { ...defaultBrand, title: "Новое оформление" },
          cookie,
        )
      ).statusCode,
    ).toBe(200);
    const original = (
      await call("GET", `/games/${game.id}/host`, undefined, cookie)
    ).json<HostGame>();
    expect(original.questions[0]!.prompt).toBe(questions[0]!.prompt);
    expect(original.brand.title).toBe(defaultBrand.title);
    expect(
      (
        await call(
          "PUT",
          "/settings",
          { ...defaultBrand, logoUrl: "javascript:alert(1)" },
          cookie,
        )
      ).statusCode,
    ).toBe(400);
  });

  test("branding uploads validate image signatures and limits and serve data without path traversal", async () => {
    const cookie = await initialize();
    const authorizedUpload = (data: Buffer, mime: string, filename: string) =>
      upload(data, mime, filename, { cookie });
    expect(
      (
        await authorizedUpload(
          Buffer.from("<svg><script>alert(1)</script></svg>"),
          "image/png",
          "logo.png",
        )
      ).statusCode,
    ).toBe(415);
    expect(
      (await authorizedUpload(png, "image/jpeg", "logo.jpg")).statusCode,
    ).toBe(415);
    expect(
      (
        await authorizedUpload(
          Buffer.alloc(2 * 1024 * 1024 + 1),
          "image/png",
          "large.png",
        )
      ).statusCode,
    ).toBe(413);
    const saved = await authorizedUpload(png, "image/png", "../../logo.png");
    expect(saved.statusCode).toBe(200);
    const url = saved.json<{ url: string }>().url;
    expect(url).toMatch(/^\/media\/[a-f0-9-]+\.png$/);
    const image = await app.inject({ method: "GET", url });
    expect(image.statusCode).toBe(200);
    expect(image.headers["content-type"]).toContain("image/png");
    expect(image.headers["x-content-type-options"]).toBe("nosniff");
    expect(image.rawPayload).toEqual(png);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/media/%2e%2e/%2e%2e/package.json",
        })
      ).statusCode,
    ).toBe(404);
    const missing = await call("GET", "/missing-endpoint");
    expect(missing.statusCode).toBe(404);
    expect(missing.headers["content-type"]).toContain("application/json");
    expect(missing.headers["cache-control"]).toBe("no-store");
  });

  test("100 simultaneous audience connections receive one persisted update without private data", async () => {
    const cookie = await initialize();
    const { game } = await createFixture(cookie);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string")
      throw new Error("HTTP listener is unavailable");
    const sockets: WebSocket[] = [];
    const nextFrame = (socket: WebSocket) =>
      new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error("Audience update did not arrive"));
        }, 10_000);
        const receive = (event: MessageEvent) => {
          cleanup();
          resolve(String(event.data));
        };
        const failed = () => {
          cleanup();
          reject(new Error("Audience socket failed"));
        };
        const cleanup = () => {
          clearTimeout(timeout);
          socket.removeEventListener("message", receive);
          socket.removeEventListener("error", failed);
        };
        socket.addEventListener("message", receive, { once: true });
        socket.addEventListener("error", failed, { once: true });
      });
    try {
      const initialFrames = await Promise.all(
        Array.from({ length: 100 }, () => {
          const socket = new WebSocket(
            `ws://127.0.0.1:${address.port}/api/ws/games/${game.id}`,
          );
          sockets.push(socket);
          return nextFrame(socket);
        }),
      );
      expect(initialFrames.map((frame) => JSON.parse(frame))).toEqual(
        Array.from({ length: 100 }, () => ({
          type: "changed",
          revision: game.revision,
        })),
      );
      const updates = Promise.all(sockets.map(nextFrame));
      const started = await call(
        "POST",
        `/games/${game.id}/commands`,
        {
          revision: game.revision,
          requestId: randomUUID(),
          command: { type: "start", teamId: game.teams[0]!.id },
        },
        cookie,
      );
      expect(started.statusCode).toBe(200);
      const updateFrames = await updates;
      expect(updateFrames.map((frame) => JSON.parse(frame))).toEqual(
        Array.from({ length: 100 }, () => ({
          type: "changed",
          revision: game.revision + 1,
        })),
      );
      expect(
        (await call("GET", `/games/${game.id}/public`)).json().revision,
      ).toBe(game.revision + 1);
    } finally {
      await Promise.all(
        sockets.map(
          (socket) =>
            new Promise<void>((resolve) => {
              if (socket.readyState === WebSocket.CLOSED) {
                resolve();
                return;
              }
              socket.addEventListener("close", () => resolve(), { once: true });
              socket.close();
            }),
        ),
      );
    }
  });

  test("completed round statistics reveal survey answers without future questions; publication is explicit and revocable", async () => {
    const cookie = await initialize();
    const { game, questions } = await createFixture(cookie);
    const publication = `/games/${game.id}/results/publication`;
    const results = `/games/${game.id}/results`;
    expect((await call("GET", results)).statusCode).toBe(404);
    expect((await call("GET", results, undefined, cookie)).statusCode).toBe(
      404,
    );
    expect(
      (await call("POST", publication, { published: true, revision: 0 }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await call(
          "POST",
          publication,
          { published: true, revision: 0 },
          cookie,
        )
      ).statusCode,
    ).toBe(409);
    let state = await hostCommand(game, cookie, {
      type: "start",
      teamId: game.teams[0]!.id,
    });
    state = await hostCommand(state, cookie, {
      type: "reveal",
      answerId: questions[0]!.answers[0]!.id,
    });
    expect(
      (await call("GET", `/games/${game.id}/public`)).json().roundStats,
    ).toBeNull();
    state = await hostCommand(state, cookie, {
      type: "award",
      teamId: game.teams[0]!.id,
    });
    const round = await call("GET", `/games/${game.id}/public`);
    expect(round.json().roundStats).toBeTruthy();
    expect(round.body).toContain(questions[0]!.answers[1]!.text);
    for (const hidden of [
      questions[1]!.prompt,
      questions[1]!.answers[0]!.text,
      "private-organizer-notes",
      "private-alias",
      game.teams[0]!.joinCode,
    ])
      expect(round.body).not.toContain(hidden);
    state = await hostCommand(state, cookie, { type: "finish" });
    expect(state.resultsPublished).toBe(false);
    expect((await call("GET", results)).statusCode).toBe(404);
    const preview = await call("GET", results, undefined, cookie);
    expect(preview.statusCode).toBe(200);
    expect(preview.body).toContain(questions[0]!.answers[0]!.text);
    expect(preview.body).toContain(questions[0]!.answers[1]!.text);
    for (const hidden of [
      questions[1]!.prompt,
      questions[1]!.answers[0]!.text,
      "private-organizer-notes",
      "private-alias",
      game.teams[0]!.joinCode,
      "password",
    ])
      expect(preview.body).not.toContain(hidden);
    expect((await call("GET", "/site")).json().games[0].resultsAvailable).toBe(
      false,
    );
    expect(
      (
        await call(
          "POST",
          publication,
          { published: true, revision: state.revision },
          cookie,
          "https://unrelated.example",
        )
      ).statusCode,
    ).toBe(403);
    const published = await call(
      "POST",
      publication,
      { published: true, revision: state.revision },
      cookie,
    );
    expect(published.statusCode).toBe(200);
    expect(published.json().revision).toBe(state.revision + 1);
    state = published.json<HostGame>();
    expect((await call("GET", results)).json()).toEqual({
      ...preview.json(),
      published: true,
      revision: state.revision,
    });
    expect(
      (await call("GET", `/games/${game.id}/public`)).json().resultsAvailable,
    ).toBe(true);
    expect((await call("GET", "/site")).json().games[0].resultsAvailable).toBe(
      true,
    );
    const noChange = await call(
      "POST",
      publication,
      { published: true, revision: state.revision },
      cookie,
    );
    expect(noChange.statusCode).toBe(200);
    expect(noChange.json().revision).toBe(state.revision);
    expect(
      (
        await call(
          "POST",
          publication,
          { published: false, revision: state.revision - 1 },
          cookie,
        )
      ).statusCode,
    ).toBe(409);
    const unpublished = await call(
      "POST",
      publication,
      { published: false, revision: state.revision },
      cookie,
    );
    expect(unpublished.statusCode).toBe(200);
    state = unpublished.json<HostGame>();
    expect((await call("GET", results)).statusCode).toBe(404);
    expect((await call("GET", results, undefined, cookie)).statusCode).toBe(
      200,
    );
    const republished = await call(
      "POST",
      publication,
      { published: true, revision: state.revision },
      cookie,
    );
    state = republished.json<HostGame>();
    state = await hostCommand(state, cookie, { type: "undo" });
    expect(state.phase).toBe("round-result");
    expect(state.resultsPublished).toBe(false);
    expect((await call("GET", results)).statusCode).toBe(404);
  });

  test("reset is atomic and retry safe, revokes every player and old invite, and keeps question snapshots", async () => {
    const cookie = await initialize();
    const { game, questions } = await createFixture(cookie);
    const member = await join(game.teams[0]!.joinCode, "Участник");
    const captain = await call(
      "POST",
      `/games/${game.id}/captain`,
      { participantId: member.participant.id },
      cookie,
    );
    const oldCommandId = randomUUID();
    let state = await hostCommand(
      captain.json<HostGame>(),
      cookie,
      {
        type: "start",
        teamId: game.teams[0]!.id,
      },
      oldCommandId,
    );
    state = await hostCommand(state, cookie, {
      type: "reveal",
      answerId: questions[0]!.answers[0]!.id,
    });
    state = await hostCommand(state, cookie, {
      type: "award",
      teamId: game.teams[0]!.id,
    });
    state = await hostCommand(state, cookie, { type: "finish" });
    const published = await call(
      "POST",
      `/games/${game.id}/results/publication`,
      { published: true, revision: state.revision },
      cookie,
    );
    expect(published.statusCode).toBe(200);
    state = published.json<HostGame>();
    const brand = { ...defaultBrand, title: "Оформление новой попытки" };
    await call("PUT", "/settings", brand, cookie);
    await call(
      "PUT",
      `/questions/${questions[0]!.id}`,
      { ...questions[0], prompt: "Обновлённая библиотека" },
      cookie,
    );
    const reset = `/games/${game.id}/reset`;
    const envelope = { revision: state.revision, requestId: randomUUID() };
    expect((await call("POST", reset, envelope)).statusCode).toBe(401);
    expect(
      (await call("POST", reset, envelope, member.cookie)).statusCode,
    ).toBe(401);
    expect(
      (await call("POST", reset, envelope, cookie, "https://unrelated.example"))
        .statusCode,
    ).toBe(403);
    const reused = await call(
      "POST",
      reset,
      { ...envelope, requestId: oldCommandId },
      cookie,
    );
    expect(reused.statusCode).toBe(409);
    expect(reused.json().code).toBe("REQUEST_ID");
    const stale = await call(
      "POST",
      reset,
      { ...envelope, revision: state.revision - 1 },
      cookie,
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("REVISION");
    const [response, simultaneousRetry] = await Promise.all([
      call("POST", reset, envelope, cookie),
      call("POST", reset, envelope, cookie),
    ]);
    expect(response.statusCode, response.body).toBe(200);
    expect(simultaneousRetry.statusCode, simultaneousRetry.body).toBe(200);
    expect(simultaneousRetry.json()).toEqual(response.json());
    const fresh = response.json<HostGame>();
    expect(fresh.id).toBe(game.id);
    expect(fresh.title).toBe(game.title);
    expect(fresh.createdAt).toBe(game.createdAt);
    expect(fresh.questions).toEqual(game.questions);
    expect(fresh.rules).toEqual(game.rules);
    expect(fresh.brand).toEqual(brand);
    expect(fresh.revision).toBe(state.revision + 1);
    expect(fresh.phase).toBe("lobby");
    expect(fresh.questionIndex).toBe(0);
    expect(fresh.paused).toBe(false);
    expect(fresh.activeTeamId).toBeNull();
    expect(fresh.originTeamId).toBeNull();
    expect(fresh.bank).toBe(0);
    expect(fresh.strikes).toBe(0);
    expect(fresh.pendingAnswer).toBeNull();
    expect(fresh.openedAnswerIds).toEqual([]);
    expect(fresh.suggestions).toEqual([]);
    expect(fresh.events).toEqual([]);
    expect(fresh.history).toEqual([]);
    expect(fresh.roundResults).toEqual([]);
    expect(fresh.resultsPublished).toBe(false);
    expect(fresh.players).toEqual([]);
    fresh.teams.forEach((team, index) => {
      expect(team.id).toBe(game.teams[index]!.id);
      expect(team.name).toBe(game.teams[index]!.name);
      expect(team.color).toBe(game.teams[index]!.color);
      expect(team.score).toBe(0);
      expect(team.joinOpen).toBe(true);
      expect(game.teams.map((old) => old.joinCode)).not.toContain(
        team.joinCode,
      );
    });
    const replay = await call("POST", reset, envelope, cookie);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(fresh);
    expect(
      (
        await pool.query(
          "SELECT request_id FROM game_commands WHERE game_id=$1",
          [game.id],
        )
      ).rows,
    ).toEqual([{ request_id: envelope.requestId }]);
    expect(
      (await pool.query("SELECT count(*)::int AS count FROM participants"))
        .rows[0].count,
    ).toBe(0);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM participant_sessions",
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      (await call("GET", "/me", undefined, member.cookie)).json().participant,
    ).toBeNull();
    expect(
      (await call("GET", `/games/${game.id}/team`, undefined, member.cookie))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await call(
          "POST",
          `/games/${game.id}/suggest`,
          {
            text: "Старый сеанс",
            revision: fresh.revision,
            requestId: randomUUID(),
          },
          member.cookie,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call("POST", "/join", {
          code: game.teams[0]!.joinCode,
          name: "Гость",
        })
      ).statusCode,
    ).toBe(404);
    expect((await call("GET", `/games/${game.id}/results`)).statusCode).toBe(
      404,
    );
    const library = (await call("GET", "/questions", undefined, cookie)).json<
      Question[]
    >();
    expect(library).toHaveLength(2);
    expect(library.find((item) => item.id === questions[0]!.id)?.prompt).toBe(
      "Обновлённая библиотека",
    );
    await join(fresh.teams[0]!.joinCode, "Новая команда");
  });

  test("deleting a game checks its revision, invalidates sessions, cascades records and closes audience connections", async () => {
    const cookie = await initialize();
    const { game } = await createFixture(cookie);
    const member = await join(game.teams[0]!.joinCode, "Участник");
    const host = await call("GET", `/games/${game.id}/host`, undefined, cookie);
    const state = await hostCommand(host.json<HostGame>(), cookie, {
      type: "start",
      teamId: game.teams[0]!.id,
    });
    const url = `/games/${game.id}`;
    expect(
      (await call("DELETE", url, { revision: state.revision })).statusCode,
    ).toBe(401);
    expect(
      (await call("DELETE", url, { revision: state.revision }, member.cookie))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await call(
          "DELETE",
          url,
          { revision: state.revision },
          cookie,
          "https://unrelated.example",
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (await call("DELETE", url, { revision: state.revision - 1 }, cookie))
        .statusCode,
    ).toBe(409);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string")
      throw new Error("HTTP listener is unavailable");
    const socket = new WebSocket(
      `ws://127.0.0.1:${address.port}/api/ws/games/${game.id}`,
    );
    const frames: unknown[] = [];
    const initial = new Promise<void>((resolve) => {
      socket.addEventListener("message", (event) => {
        frames.push(JSON.parse(String(event.data)));
        resolve();
      });
    });
    const closed = new Promise<void>((resolve) =>
      socket.addEventListener("close", () => resolve(), { once: true }),
    );
    try {
      await initial;
      const deleted = await call(
        "DELETE",
        url,
        { revision: state.revision },
        cookie,
      );
      expect(deleted.statusCode).toBe(200);
      expect(deleted.json()).toEqual({ ok: true });
      await closed;
      expect(frames).toEqual([
        { type: "changed", revision: state.revision },
        { type: "changed", revision: state.revision + 1 },
      ]);
      for (const table of [
        "games",
        "participants",
        "participant_sessions",
        "game_commands",
      ])
        expect(
          (await pool.query(`SELECT count(*)::int AS count FROM ${table}`))
            .rows[0].count,
        ).toBe(0);
      expect(
        (await pool.query("SELECT count(*)::int AS count FROM questions"))
          .rows[0].count,
      ).toBe(2);
      expect(
        (await call("GET", "/me", undefined, member.cookie)).json().participant,
      ).toBeNull();
      expect(
        (await call("GET", `${url}/host`, undefined, cookie)).statusCode,
      ).toBe(404);
      expect((await call("GET", `${url}/public`)).statusCode).toBe(404);
      expect((await call("GET", `${url}/results`)).statusCode).toBe(404);
      expect((await call("GET", "/site")).json().games).toEqual([]);
      expect(
        (
          await call("POST", "/join", {
            code: game.teams[0]!.joinCode,
            name: "Гость",
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (await call("DELETE", url, { revision: state.revision }, cookie))
          .statusCode,
      ).toBe(404);
    } finally {
      if (socket.readyState !== WebSocket.CLOSED) socket.close();
    }
  });

  test("players stay inside their team; one captain submits, retries do not duplicate, and steal/undo survive restart", async () => {
    const adminCookie = await initialize();
    const { game, questions } = await createFixture(adminCookie);
    const [left, right] = game.teams;
    const captain = await join(left!.joinCode, "Капитан А");
    const player = await join(left!.joinCode, "Игрок А");
    const rival = await join(right!.joinCode, "Капитан Б");
    let state = (
      await call(
        "POST",
        `/games/${game.id}/captain`,
        { participantId: captain.participant.id },
        adminCookie,
      )
    ).json<HostGame>();
    state = (
      await call(
        "POST",
        `/games/${game.id}/captain`,
        { participantId: rival.participant.id },
        adminCookie,
      )
    ).json<HostGame>();
    const host = async () =>
      (
        await call("GET", `/games/${game.id}/host`, undefined, adminCookie)
      ).json<HostGame>();
    const command = async (command: HostCommand) => {
      const response = await call(
        "POST",
        `/games/${game.id}/commands`,
        { command, revision: state.revision, requestId: randomUUID() },
        adminCookie,
      );
      expect(response.statusCode).toBe(200);
      state = response.json<HostGame>();
      return state;
    };
    const publicBefore = await call("GET", `/games/${game.id}/public`);
    expect(publicBefore.json().prompt).toBe("");
    expect(publicBefore.body).not.toContain(questions[0]!.prompt);
    expect(publicBefore.body).not.toContain(left!.joinCode);
    expect(
      (await call("GET", `/games/${game.id}/host`, undefined, player.cookie))
        .statusCode,
    ).toBe(401);
    expect((await call("GET", `/games/${game.id}/team`)).statusCode).toBe(403);
    const another = await createFixture(adminCookie);
    expect(
      (
        await call(
          "GET",
          `/games/${another.game.id}/team`,
          undefined,
          player.cookie,
        )
      ).statusCode,
    ).toBe(403);
    await command({ type: "start", teamId: left!.id });
    const publicPlaying = await call("GET", `/games/${game.id}/public`);
    expect(publicPlaying.json().answers).toEqual([
      { position: 1, opened: false },
      { position: 2, opened: false },
    ]);
    for (const hidden of [
      questions[0]!.answers[0]!.text,
      questions[1]!.prompt,
      left!.joinCode,
      "private-organizer-notes",
      "private-survey-source",
      "private-alias",
    ]) {
      expect(publicPlaying.body).not.toContain(hidden);
      expect((await call("GET", "/site")).body).not.toContain(hidden);
    }
    const proposal = {
      text: "Приватное предложение команды А",
      requestId: randomUUID(),
      revision: state.revision,
    };
    const suggested = await call(
      "POST",
      `/games/${game.id}/suggest`,
      proposal,
      player.cookie,
    );
    expect(suggested.statusCode).toBe(200);
    expect(suggested.json<TeamGame>().suggestions).toHaveLength(1);
    const replay = await call(
      "POST",
      `/games/${game.id}/suggest`,
      proposal,
      player.cookie,
    );
    expect(replay.statusCode).toBe(200);
    expect(replay.json<TeamGame>().suggestions).toHaveLength(1);
    expect(replay.json<TeamGame>().revision).toBe(
      suggested.json<TeamGame>().revision,
    );
    expect(
      (
        await call(
          "POST",
          `/games/${game.id}/suggest`,
          { ...proposal, text: "Changed payload" },
          player.cookie,
        )
      ).statusCode,
    ).toBe(409);
    state = await host();
    const rivalView = (
      await call("GET", `/games/${game.id}/team`, undefined, rival.cookie)
    ).json<TeamGame>();
    expect(rivalView.players.map((p) => p.name)).toEqual(["Капитан Б"]);
    expect(rivalView.suggestions).toEqual([]);
    expect((await call("GET", `/games/${game.id}/public`)).body).not.toContain(
      proposal.text,
    );
    expect(
      (
        await call(
          "POST",
          `/games/${game.id}/submit`,
          { text: "Ответ", revision: state.revision, requestId: randomUUID() },
          player.cookie,
        )
      ).statusCode,
    ).toBe(403);
    const submitted = await call(
      "POST",
      `/games/${game.id}/submit`,
      {
        text: questions[0]!.answers[0]!.text,
        revision: state.revision,
        requestId: randomUUID(),
      },
      captain.cookie,
    );
    expect(submitted.statusCode).toBe(200);
    state = await host();
    expect(state.pendingAnswer?.participantId).toBe(captain.participant.id);
    expect(
      (
        await call("GET", `/games/${game.id}/team`, undefined, rival.cookie)
      ).json().pendingAnswer,
    ).toBeNull();
    expect(
      (
        await call(
          "POST",
          `/games/${game.id}/commands`,
          {
            command: { type: "strike" },
            revision: state.revision - 1,
            requestId: randomUUID(),
          },
          adminCookie,
        )
      ).statusCode,
    ).toBe(409);
    await command({ type: "reveal", answerId: questions[0]!.answers[0]!.id });
    expect(state.bank).toBe(60);
    expect(state.pendingAnswer).toBeNull();
    for (let index = 0; index < 3; index++) await command({ type: "strike" });
    expect(state.phase).toBe("steal");
    expect(state.activeTeamId).toBe(right!.id);
    expect(
      (
        await call(
          "POST",
          `/games/${game.id}/submit`,
          {
            text: "Не наш ход",
            revision: state.revision,
            requestId: randomUUID(),
          },
          captain.cookie,
        )
      ).statusCode,
    ).toBe(409);
    await command({ type: "reveal", answerId: questions[0]!.answers[1]!.id });
    expect(state.phase).toBe("round-result");
    expect(state.teams[1]!.score).toBe(100);
    await command({ type: "undo" });
    expect(state.phase).toBe("steal");
    expect(state.bank).toBe(60);
    expect(state.teams[1]!.score).toBe(0);
    const revisionBeforeRestart = state.revision;
    await app.close();
    app = await buildApp({ pool, mediaDir, publicOrigin: ORIGIN });
    await app.ready();
    state = await host();
    expect(state.revision).toBe(revisionBeforeRestart);
    expect(state.phase).toBe("steal");
    expect(
      (await call("GET", "/me", undefined, captain.cookie)).json().participant
        .role,
    ).toBe("captain");
    const durableReplay = await call(
      "POST",
      `/games/${game.id}/suggest`,
      proposal,
      player.cookie,
    );
    expect(durableReplay.statusCode).toBe(200);
    expect(durableReplay.json<TeamGame>().revision).toBe(revisionBeforeRestart);
    expect(durableReplay.json<TeamGame>().suggestions).toEqual([]);
    await command({ type: "reveal", answerId: questions[0]!.answers[1]!.id });
    await command({ type: "next", teamId: left!.id });
    expect(state.questionIndex).toBe(1);
    const race = await Promise.all([
      call(
        "POST",
        `/games/${game.id}/commands`,
        {
          command: { type: "reveal", answerId: questions[1]!.answers[0]!.id },
          revision: state.revision,
          requestId: randomUUID(),
        },
        adminCookie,
      ),
      call(
        "POST",
        `/games/${game.id}/commands`,
        {
          command: { type: "strike" },
          revision: state.revision,
          requestId: randomUUID(),
        },
        adminCookie,
      ),
    ]);
    expect(race.map((response) => response.statusCode).sort()).toEqual([
      200, 409,
    ]);
    const beforeRace = state.revision;
    state = await host();
    expect(state.revision).toBe(beforeRace + 1);
    await command({ type: "finish" });
    expect(state.phase).toBe("finished");
    expect(
      (
        await call("POST", "/join", {
          code: left!.joinCode,
          name: "Поздний гость",
        })
      ).statusCode,
    ).toBe(409);
  });
});
