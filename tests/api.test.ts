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
  type HostCommand,
  type HostGame,
  type Participant,
  type Question,
  type TeamGame,
} from "../shared/types";

const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "Integration-only!12345";
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
          { currentPassword: "wrong", newPassword: "Replacement-only!45678" },
          adminCookie,
        )
      ).statusCode,
    ).toBe(400);
    const changed = await call(
      "POST",
      "/account/password",
      { currentPassword: PASSWORD, newPassword: "Replacement-only!45678" },
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
          password: "Replacement-only!45678",
        })
      ).statusCode,
    ).toBe(200);
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
    const upload = (data: Buffer, mime: string, filename: string) => {
      const boundary = "ctok-test-upload-boundary";
      return app.inject({
        method: "POST",
        url: "/api/media",
        headers: {
          cookie,
          origin: ORIGIN,
          "content-type": `multipart/form-data; boundary=${boundary}`,
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
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ1sAAAAASUVORK5CYII=",
      "base64",
    );
    expect(
      (
        await upload(
          Buffer.from("<svg><script>alert(1)</script></svg>"),
          "image/png",
          "logo.png",
        )
      ).statusCode,
    ).toBe(415);
    expect((await upload(png, "image/jpeg", "logo.jpg")).statusCode).toBe(415);
    expect(
      (
        await upload(
          Buffer.alloc(2 * 1024 * 1024 + 1),
          "image/png",
          "large.png",
        )
      ).statusCode,
    ).toBe(413);
    const saved = await upload(png, "image/png", "../../logo.png");
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
