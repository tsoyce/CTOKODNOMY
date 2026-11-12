import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../server/app";
import { issueSetupToken } from "../server/db";
import { defaultBrand, type HostCommand, type HostGame, type Participant, type Question } from "../shared/types";

const ORIGIN = "http://127.0.0.1:3000";
const databaseUrl = process.env.DATABASE_URL_TEST;
if (!databaseUrl || !decodeURIComponent(new URL(databaseUrl).pathname).endsWith("_test")) {
  throw new Error("Classic API tests require a separate _test PostgreSQL database.");
}

describe("classic game across the actual API and persisted state", () => {
  let app: FastifyInstance;
  let pool: pg.Pool;
  let controlPool: pg.Pool;
  let schema: string;
  let mediaDir: string;

  beforeEach(async () => {
    schema = `classic_${randomUUID().replaceAll("-", "")}`;
    controlPool = new pg.Pool({ connectionString: databaseUrl });
    await controlPool.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    mediaDir = await mkdtemp(path.join(tmpdir(), "ctok-classic-api-"));
    app = await buildApp({ pool, mediaDir, publicOrigin: ORIGIN });
    await app.ready();
  });

  afterEach(async () => {
    await app?.close();
    await pool?.end();
    if (controlPool) {
      if (schema) await controlPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await controlPool.end();
    }
    if (mediaDir) await rm(mediaDir, { recursive: true, force: true });
  });

  function request(method: "GET" | "POST", url: string, data?: unknown, cookie?: string) {
    return app.inject({
      method, url: `/api${url}`,
      ...(data === undefined ? {} : { payload: JSON.stringify(data) }),
      headers: {
        origin: ORIGIN,
        ...(data === undefined ? {} : { "content-type": "application/json" }),
        ...(cookie ? { cookie } : {}),
      },
    });
  }

  function cookie(headers: Record<string, unknown>): string {
    const value = headers["set-cookie"];
    return (Array.isArray(value) ? value : [value])
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.split(";")[0]).join("; ");
  }

  function survey(index: number): Question {
    return {
      id: randomUUID(), prompt: `Секретный вопрос ${index}`,
      answers: [40, 25, 15, 10, 6, 4].map((points, position) => ({
        id: randomUUID(), text: `Ответ ${index}-${position}`, points, aliases: [],
      })),
      source: "Тестовый опрос", surveyDate: "", respondentCount: 100,
      notes: "Организаторская заметка", isDemo: true, pack: "Классика",
    };
  }

  test("a duel, three strikes and steal, reverse round, and two-player final preserve scoring and secrets", async () => {
    const setup = await request("POST", "/setup", {
      token: await issueSetupToken(pool), username: "organizer", password: "x", brand: defaultBrand,
    });
    expect(setup.statusCode, setup.body).toBe(200);
    const admin = cookie(setup.headers);
    const questions = Array.from({ length: 9 }, (_, i) => survey(i + 1));
    questions[4]!.answers[0]!.originals = ["Приватная исходная фраза финалиста"];
    questions[4]!.answers[0]!.aliases = ["Приватный синоним финала"];
    const imported = await request("POST", "/questions/import", {
      format: "ctokodnomy-questions-v1", questions,
    }, admin);
    expect(imported.statusCode, imported.body).toBe(200);
    const created = await request("POST", "/games", {
      title: "Тест классической игры", questionIds: questions.map((q) => q.id),
      teams: [{ name: "Первая", color: "#123456" }, { name: "Вторая", color: "#abcdef" }],
      rules: { mode: "classic", multipliers: [1, 2, 3], stealAddsPoints: true },
    }, admin);
    expect(created.statusCode, created.body).toBe(200);
    let state = created.json<HostGame>();
    const [a, b] = state.teams;
    expect(a).toBeDefined(); expect(b).toBeDefined();
    const join = await request("POST", "/join", { code: a!.joinCode, name: "Капитан" });
    expect(join.statusCode, join.body).toBe(200);
    const participant = join.json<{ participant: Participant }>().participant;
    const assign = await request("POST", `/games/${state.id}/captain`, { participantId: participant.id }, admin);
    expect(assign.statusCode, assign.body).toBe(200);
    state = assign.json<HostGame>();

    async function command(value: HostCommand) {
      const response = await request("POST", `/games/${state.id}/commands`, {
        command: value, requestId: randomUUID(), revision: state.revision,
      }, admin);
      expect(response.statusCode, `${JSON.stringify(value)}: ${response.body}`).toBe(200);
      state = response.json<HostGame>();
      return state;
    }
    async function publicGame() {
      const response = await request("GET", `/games/${state.id}/public`);
      expect(response.statusCode).toBe(200);
      return response;
    }
    const reveal = (round: number, position: number) => command({
      type: "reveal", answerId: questions[round]!.answers[position]!.id,
    });

    await command({ type: "start", teamId: a!.id });
    let audience = await publicGame();
    expect(audience.body).not.toContain(questions[0]!.answers[0]!.text);
    expect(audience.body).not.toContain(questions[4]!.prompt);
    expect(audience.body).not.toContain(a!.joinCode);
    const buzz = await request("POST", `/games/${state.id}/buzz`, {
      requestId: randomUUID(), revision: state.revision,
    }, cookie(join.headers));
    expect(buzz.statusCode, buzz.body).toBe(200);
    const host = await request("GET", `/games/${state.id}/host`, undefined, admin);
    state = host.json<HostGame>();
    expect(state.classic?.duel?.firstTeamId).toBe(a!.id);
    await reveal(0, 0);
    expect(state.bank).toBe(40);
    for (let i = 0; i < 3; i++) await command({ type: "strike" });
    expect(state.phase).toBe("steal");
    expect(state.activeTeamId).toBe(b!.id);
    await command({ type: "strike" });
    expect(state.phase).toBe("round-result");
    expect(state.teams.map((team) => team.score)).toEqual([40, 0]);

    await command({ type: "next" });
    await command({ type: "classic-buzz", teamId: a!.id });
    await reveal(1, 0);
    await reveal(1, 1);
    for (let i = 0; i < 3; i++) await command({ type: "strike" });
    await reveal(1, 2);
    expect(state.teams.map((team) => team.score)).toEqual([40, 160]);
    expect(state.phase).toBe("round-result");

    await command({ type: "next" });
    await command({ type: "classic-buzz", teamId: b!.id });
    await reveal(2, 1);
    expect(state.classic?.stage).toBe("duel");
    expect(state.activeTeamId).toBe(a!.id);
    expect(state.strikes).toBe(0);
    await reveal(2, 2);
    expect(state.classic?.stage).toBe("play");
    expect(state.activeTeamId).toBe(b!.id);
    expect(state.bank).toBe(120);
    expect(state.strikes).toBe(0);
    for (let i = 0; i < 3; i++) await command({ type: "strike" });
    await command({ type: "strike" });
    expect(state.teams.map((team) => team.score)).toEqual([40, 280]);
    await command({ type: "next" });
    expect(state.classic?.stage).toBe("reverse");
    expect(state.activeTeamId).toBe(a!.id);
    await reveal(3, 5);
    expect(state.teams.map((team) => team.score)).toEqual([280, 280]);
    expect(state.activeTeamId).toBe(b!.id);
    await reveal(3, 0);
    expect(state.teams.map((team) => team.score)).toEqual([280, 295]);
    expect(state.phase).toBe("round-result");

    await command({ type: "next" });
    expect(state.classic?.stage).toBe("final");
    expect(state.classic?.final?.teamId).toBe(b!.id);
    expect((await request("GET", `/games/${state.id}/results`)).statusCode).toBeGreaterThanOrEqual(400);
    audience = await publicGame();
    for (const q of questions.slice(4)) {
      expect(audience.body).not.toContain(q.prompt);
      expect(audience.body).not.toContain(q.answers[0]!.text);
    }
    await command({ type: "classic-final-start" });
    for (let i = 0; i < 5; i++) await command({
      type: "classic-final-pick", questionIndex: i, answerId: questions[4 + i]!.answers[0]!.id,
    });
    await command({ type: "classic-final-stop" });
    expect(state.classic?.final?.score).toBe(200);
    await command({ type: "classic-final-next" });
    expect(state.classic?.final?.player).toBe(2);
    await command({ type: "classic-final-start" });
    const repeated = await request("POST", `/games/${state.id}/commands`, {
      command: { type: "classic-final-pick", questionIndex: 0, answerId: questions[4]!.answers[0]!.id },
      requestId: randomUUID(), revision: state.revision,
    }, admin);
    expect(repeated.statusCode).toBeGreaterThanOrEqual(400);
    // The first finalist's answers stay masked on the board while the second plays.
    audience = await publicGame();
    expect(audience.body).not.toContain(questions[4]!.answers[0]!.text);
    for (let i = 0; i < 5; i++) await command({
      type: "classic-final-pick", questionIndex: i, answerId: questions[4 + i]!.answers[1]!.id,
    });
    await command({ type: "classic-final-stop" });
    await command({ type: "classic-final-next" });
    expect(state.phase).toBe("finished");
    expect(state.classic?.final?.score).toBe(325);
    audience = await publicGame();
    // Only the answers the finalists gave are shown; the rest of the survey is not.
    expect(audience.body).toContain(questions[4]!.answers[0]!.text);
    expect(audience.body).not.toContain(questions[4]!.answers[2]!.text);
    const unpublished = await request("GET", `/games/${state.id}/results`);
    expect(unpublished.statusCode).toBeGreaterThanOrEqual(400);
    const preview = await request("GET", `/games/${state.id}/results`, undefined, admin);
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().classicFinal).toMatchObject({ teamId: b!.id, score: 325, superPrize: true });
    expect(preview.json().classicFinal.questions).toHaveLength(5);
    expect(preview.json().classicFinal.questions[0].answers[0]).toMatchObject({
      text: questions[4]!.answers[0]!.text, points: 40, share: 40,
    });
    expect(preview.body).not.toContain("Приватная исходная фраза финалиста");
    expect(preview.body).not.toContain("Приватный синоним финала");
    expect(preview.body).not.toContain("Организаторская заметка");
    expect(preview.body).not.toContain(a!.joinCode);
    const published = await request("POST", `/games/${state.id}/results/publication`, {
      published: true, revision: state.revision,
    }, admin);
    expect(published.statusCode, published.body).toBe(200);
    const publicResults = await request("GET", `/games/${state.id}/results`);
    expect(publicResults.statusCode).toBe(200);
    expect(publicResults.json().classicFinal.questions).toHaveLength(5);
    expect(publicResults.body).not.toContain("Приватная исходная фраза финалиста");
    expect(publicResults.body).not.toContain("Приватный синоним финала");
  });

  test("ties use a dedicated question or an explicit host decision, with pause and expiry in the final", async () => {
    const setup = await request("POST", "/setup", {
      token: await issueSetupToken(pool), username: "organizer", password: "x", brand: defaultBrand,
    });
    expect(setup.statusCode, setup.body).toBe(200);
    const admin = cookie(setup.headers);
    const questions = Array.from({ length: 10 }, (_, i) => survey(i + 1));
    const imported = await request("POST", "/questions/import", {
      format: "ctokodnomy-questions-v1", questions,
    }, admin);
    expect(imported.statusCode, imported.body).toBe(200);

    for (const questionCount of [9, 10]) {
      const created = await request("POST", "/games", {
        title: `Тай-брейк ${questionCount}`, questionIds: questions.slice(0, questionCount).map((q) => q.id),
        teams: [{ name: "Первая", color: "#123456" }, { name: "Вторая", color: "#abcdef" }],
        rules: { mode: "classic", multipliers: [1, 2, 3], stealAddsPoints: true },
      }, admin);
      expect(created.statusCode, created.body).toBe(200);
      let state = created.json<HostGame>();
      const [a, b] = state.teams;
      async function command(value: HostCommand) {
        const result = await request("POST", `/games/${state.id}/commands`, {
          command: value, requestId: randomUUID(), revision: state.revision,
        }, admin);
        expect(result.statusCode, `${JSON.stringify(value)}: ${result.body}`).toBe(200);
        state = result.json<HostGame>();
        return state;
      }

      await command({ type: "start", teamId: a!.id });
      for (let round = 0; round < 3; round++) {
        await command({ type: "classic-buzz", teamId: a!.id });
        await command({ type: "reveal", answerId: questions[round]!.answers[0]!.id });
        for (let i = 0; i < 4; i++) await command({ type: "strike" });
        if (round < 2) await command({ type: "next" });
      }
      expect(state.teams.map((team) => team.score)).toEqual([240, 0]);
      await command({ type: "adjust", teamId: b!.id, delta: 240, reason: "Сценарий ничьей" });
      await command({ type: "next", teamId: a!.id });
      await command({ type: "strike" });
      await command({ type: "strike" });
      expect(state.teams[0]!.score).toBe(state.teams[1]!.score);
      await command({ type: "next" });
      expect(state.classic?.stage).toBe("tiebreak");

      if (questionCount === 10) {
        expect(state.questionIndex).toBe(9);
        await command({ type: "classic-buzz", teamId: a!.id });
        await command({ type: "strike" });
        expect(state.activeTeamId).toBe(b!.id);
        expect(state.strikes).toBe(0);
        await command({ type: "reveal", answerId: questions[9]!.answers[0]!.id });
      } else {
        expect(state.classic?.duel).toBeNull();
        await command({ type: "classic-tiebreak-winner", teamId: b!.id });
      }
      expect(state.classic?.stage).toBe("final");
      expect(state.classic?.final?.teamId).toBe(b!.id);
      await command({ type: "classic-final-start" });
      expect(state.classic?.final?.deadlineAt).toBeGreaterThan(Date.now());
      await command({ type: "pause" });
      expect(state.classic?.final?.deadlineAt).toBeNull();
      expect(state.classic?.final?.remainingMs).toBeGreaterThan(0);
      await command({ type: "resume" });
      expect(state.classic?.final?.deadlineAt).toBeGreaterThan(Date.now());
      // The test owns this isolated schema. Put the persisted deadline in the past
      // so expiry is deterministic without waiting for a real 15-second timer.
      await pool.query(
        "UPDATE games SET state=jsonb_set(state, '{classic,final,deadlineAt}', to_jsonb($2::bigint)) WHERE id=$1",
        [state.id, Date.now() - 1000],
      );
      // Answers may be marked after the signal; doing so closes the timer.
      await command({ type: "classic-final-pick", questionIndex: 0, answerId: questions[4]!.answers[0]!.id });
      expect(state.classic?.final?.phase).toBe("review");
      expect(state.classic?.final?.deadlineAt).toBeNull();
      expect(state.classic?.final?.score).toBeGreaterThan(0);
    }
  });
});
