import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { z, ZodError } from "zod";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  defaultBrand,
  type Brand,
  type GameCommand,
  type GameState,
  type HostGame,
  type Me,
  type Participant,
  type Question,
} from "../shared/types.js";
import {
  IMPORT_MAX_BYTES,
  questionSchema,
  questionPackSchema,
  questionImportIssues,
} from "../shared/questionImport.js";
import {
  createGame,
  applyCommand,
  publicView,
  teamView,
  normalizeGameState,
  resetGame,
  gameResults,
} from "./game.js";
import { createDemoQuestions } from "./demo.js";
import {
  createDatabase,
  migrate,
  newToken,
  passwordHash,
  tokenHash,
  transaction,
  verifyPassword,
  type Database,
  type Transaction,
} from "./db.js";

class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
const idSchema = z.uuid();
const questionImportRequestSchema = questionPackSchema.safeExtend({
  replaceIds: z
    .array(
      z.uuid({ error: "Используйте корректный UUID для подтверждения замены" })
        .transform((value) => value.toLowerCase()),
      { error: "Передайте идентификаторы подтверждённых замен списком" },
    )
    .max(500, "Можно подтвердить не больше 500 замен")
    .optional(),
});
const color = z
  .string()
  .regex(/^#[a-fA-F0-9]{6}$/, "Используйте цвет в формате #RRGGBB");
const imageUrl = z
  .string()
  .max(1000)
  .refine(
    (v) =>
      !v ||
      /^\/media\/[a-f0-9-]+\.(png|jpe?g|webp)$/.test(v) ||
      /^https:\/\//.test(v),
    "Используйте загруженное изображение или HTTPS-ссылку",
  );
const brandSchema = z.object({
  title: z.string().trim().min(1).max(150),
  description: z.string().max(1000),
  organizer: z.string().max(150),
  heroTitle: z.string().max(200).default(defaultBrand.heroTitle),
  heroNote: z.string().max(300).default(defaultBrand.heroNote),
  footerText: z.string().max(300).default(defaultBrand.footerText),
  primary: color,
  accent: color,
  background: color,
  textColor: color,
  logoUrl: imageUrl,
  gameLogoUrl: imageUrl,
  faviconUrl: imageUrl,
  partnerLogoUrls: z.array(imageUrl).max(12),
});
const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[a-zA-Z0-9_.@-]+$/)
  .transform((v) => v.toLowerCase());
const passwordSchema = z.string().min(1, "Введите пароль").max(128);
const normalizeBrand = (brand: Partial<Brand>): Brand => ({
  ...defaultBrand,
  ...brand,
});
const dummyPasswordHash = `scrypt:${"0".repeat(32)}:${"0".repeat(128)}`;
const rulesSchema = z.object({
  multipliers: z.array(z.number().int().min(1).max(100)).min(1).max(20),
  stealAddsPoints: z.boolean(),
});
const teamSchema = z.object({ name: z.string().trim().min(1).max(80), color });
const hostCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start"), teamId: idSchema }),
  z.object({ type: z.literal("reveal"), answerId: idSchema }),
  z.object({ type: z.literal("strike") }),
  z.object({ type: z.literal("next"), teamId: idSchema.optional() }),
  z.object({ type: z.literal("award"), teamId: idSchema }),
  z.object({ type: z.literal("turn"), teamId: idSchema }),
  z.object({ type: z.literal("pause") }),
  z.object({ type: z.literal("resume") }),
  z.object({ type: z.literal("undo") }),
  z.object({ type: z.literal("finish") }),
  z.object({
    type: z.literal("adjust"),
    teamId: idSchema,
    delta: z.number().int().min(-100_000).max(100_000),
    reason: z.string().trim().min(1).max(300),
  }),
  z.object({
    type: z.literal("join-toggle"),
    teamId: idSchema,
    open: z.boolean(),
  }),
]);
const commandEnvelope = z.object({
  requestId: z
    .string()
    .min(8)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/),
  revision: z.number().int().min(0),
  command: hostCommandSchema,
});
const participantEnvelope = commandEnvelope
  .omit({ command: true })
  .extend({ text: z.string().trim().min(1).max(200) });
const gameId = (request: FastifyRequest) =>
  idSchema.parse((request.params as { id: string }).id);
const mapQuestion = (value: unknown): Question => {
  const q = questionSchema.parse(value);
  return {
    ...q,
    id: q.id ?? randomUUID(),
    answers: q.answers.map((a) => ({ ...a, id: a.id ?? randomUUID() })),
  };
};
const players = async (
  db: Database | Transaction,
  id: string,
): Promise<Participant[]> =>
  (
    await db.query(
      'SELECT id,game_id AS "gameId",team_id AS "teamId",name,role FROM participants WHERE game_id=$1 ORDER BY created_at,id',
      [id],
    )
  ).rows;
const hostGame = async (
  db: Database | Transaction,
  state: GameState,
): Promise<HostGame> => ({ ...state, players: await players(db, state.id) });
async function loadGame(
  db: Database | Transaction,
  id: string,
  lock = false,
): Promise<GameState> {
  const result = await db.query(
    `SELECT state FROM games WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  if (!result.rowCount) throw new ApiError(404, "Игра не найдена", "NOT_FOUND");
  const state = result.rows[0].state as GameState;
  return normalizeGameState({ ...state, brand: normalizeBrand(state.brand) });
}
const saveGame = (db: Transaction, state: GameState) =>
  db.query("UPDATE games SET state=$2::jsonb,updated_at=now() WHERE id=$1", [
    state.id,
    JSON.stringify(state),
  ]);

export interface BuildAppOptions {
  databaseUrl?: string;
  pool?: Database;
  staticDir?: string;
  mediaDir?: string;
  logger?: boolean;
  publicOrigin?: string;
  secureCookies?: boolean;
  migrate?: boolean;
}
export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const pool = options.pool ?? createDatabase(options.databaseUrl);
  if (options.migrate !== false) await migrate(pool);
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: IMPORT_MAX_BYTES,
    trustProxy: process.env.TRUST_PROXY === "1",
    logController: new LogController({ disableRequestLogging: true }),
  });
  if (!options.pool)
    app.addHook("onClose", async () => {
      await pool.end();
    });
  const mediaDir = path.resolve(
    options.mediaDir ?? process.env.MEDIA_DIR ?? "data/uploads",
  );
  await mkdir(mediaDir, { recursive: true });
  const originSetting =
    options.publicOrigin ?? process.env.APP_ORIGIN ?? process.env.PUBLIC_ORIGIN;
  const publicOrigin = originSetting
    ? new URL(originSetting).origin
    : undefined;
  if (
    process.env.NODE_ENV === "production" &&
    (!publicOrigin || !publicOrigin.startsWith("https://"))
  )
    throw new Error("APP_ORIGIN must be a public HTTPS origin in production.");
  const secure = options.secureCookies ?? process.env.NODE_ENV === "production";
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
  };
  const adminCookie = "ctok_admin",
    participantCookie = "ctok_player";
  const sockets = new Map<
    string,
    Set<{ send(data: string): void; readyState: number; close(): void }>
  >();
  const broadcast = (state: GameState) => {
    const message = JSON.stringify({
      type: "changed",
      revision: state.revision,
    });
    for (const socket of sockets.get(state.id) ?? [])
      if (socket.readyState === 1) socket.send(message);
  };
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(multipart, {
    limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
    throwFileSizeLimit: true,
  });
  await app.register(websocket, { options: { maxPayload: 1024 } });
  app.addHook("onRequest", async (request, reply) => {
    // API errors and authenticated JSON never enter a shared browser/proxy cache.
    if (request.url.startsWith("/api/"))
      reply.header("Cache-Control", "no-store");
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
    const origin = request.headers.origin;
    if (!origin) return;
    const allowed =
      publicOrigin ?? `${request.protocol}://${request.headers.host}`;
    if (origin !== allowed)
      throw new ApiError(403, "Запрос с другого сайта запрещён", "ORIGIN");
  });
  app.addHook("onSend", async (_request, reply, payload) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "same-origin")
      .header("X-Frame-Options", "DENY");
    return payload;
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        message: error.issues
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join("; "),
        code: "VALIDATION",
      });
    }
    const typed = error as Error & { statusCode?: number; code?: string };
    if (typed.code === "23505")
      return reply
        .code(409)
        .send({ message: "Такая запись уже существует", code: "CONFLICT" });
    const status =
      typed.statusCode && typed.statusCode >= 400 && typed.statusCode < 500
        ? typed.statusCode
        : 500;
    // Do not log request bodies, cookies, tokens, connection strings or database error parameters.
    if (status === 500)
      request.log.error({ errorType: typed.name }, "Request failed");
    return reply.code(status).send({
      message:
        status === 500 ? "Ошибка сервера. Повторите запрос." : typed.message,
      ...(typed.code && status !== 500 ? { code: typed.code } : {}),
    });
  });
  async function getAdmin(request: FastifyRequest): Promise<Me["admin"]> {
    const token = request.cookies[adminCookie];
    if (!token) return null;
    const result = await pool.query(
      "SELECT a.id,a.username FROM admin_sessions s JOIN admins a ON a.id=s.admin_id WHERE s.token_hash=$1 AND s.expires_at>now()",
      [tokenHash(token)],
    );
    return result.rows[0] ?? null;
  }
  async function requireAdmin(request: FastifyRequest) {
    const admin = await getAdmin(request);
    if (!admin)
      throw new ApiError(401, "Войдите как администратор", "AUTH_REQUIRED");
    return admin;
  }
  async function getParticipant(
    request: FastifyRequest,
  ): Promise<Participant | null> {
    const token = request.cookies[participantCookie];
    if (!token) return null;
    const result = await pool.query(
      'SELECT p.id,p.game_id AS "gameId",p.team_id AS "teamId",p.name,p.role FROM participant_sessions s JOIN participants p ON p.id=s.participant_id WHERE s.token_hash=$1 AND s.expires_at>now()',
      [tokenHash(token)],
    );
    return result.rows[0] ?? null;
  }
  async function requireParticipant(request: FastifyRequest, id: string) {
    const participant = await getParticipant(request);
    if (!participant || participant.gameId !== id)
      throw new ApiError(
        403,
        "Присоединитесь к команде этой игры",
        "TEAM_REQUIRED",
      );
    return participant;
  }
  async function createAdminSession(adminId: string, reply: FastifyReply) {
    const token = newToken();
    await pool.query(
      "INSERT INTO admin_sessions(token_hash,admin_id,expires_at) VALUES($1,$2,now()+interval '12 hours')",
      [tokenHash(token), adminId],
    );
    reply.setCookie(adminCookie, token, {
      ...cookieOptions,
      maxAge: 12 * 3600,
    });
  }
  const me = async (request: FastifyRequest): Promise<Me> => {
    const [admin, participant] = await Promise.all([
      getAdmin(request),
      getParticipant(request),
    ]);
    return { admin, participant };
  };
  const health = async () => {
    await pool.query("SELECT 1");
    return { ok: true };
  };
  app.get("/health", health);
  app.get("/api/health", health);
  app.get("/api/me", me);
  app.get("/api/site", async () => {
    const [settings, games] = await Promise.all([
      pool.query("SELECT initialized,brand FROM app_settings WHERE id=1"),
      pool.query("SELECT state FROM games ORDER BY created_at DESC LIMIT 100"),
    ]);
    const initialized = settings.rows[0].initialized;
    return {
      initialized,
      brand: initialized
        ? normalizeBrand(settings.rows[0].brand)
        : defaultBrand,
      games: games.rows.map(({ state }: { state: GameState }) => {
        const game = normalizeGameState(state);
        return {
          id: game.id,
          title: game.title,
          phase: game.phase,
          teams: publicView(game).teams,
          createdAt: game.createdAt,
          revision: game.revision,
          resultsAvailable: game.phase === "finished" && game.resultsPublished,
        };
      }),
    };
  });
  app.post(
    "/api/setup",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = z
        .object({
          token: z.string().min(20).max(200),
          username: usernameSchema,
          password: passwordSchema,
          brand: brandSchema,
        })
        .parse(request.body);
      const hash = await passwordHash(body.password);
      const admin = await transaction(pool, async (client) => {
        const settings = await client.query(
          "SELECT initialized FROM app_settings WHERE id=1 FOR UPDATE",
        );
        if (settings.rows[0].initialized)
          throw new ApiError(409, "Приложение уже настроено", "INITIALIZED");
        const grant = await client.query(
          "SELECT token_hash FROM setup_grants WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE",
          [tokenHash(body.token)],
        );
        if (!grant.rowCount)
          throw new ApiError(
            403,
            "Код установки неверен или истёк. Создайте новый в консоли сервера.",
            "SETUP_TOKEN",
          );
        const admin = { id: randomUUID(), username: body.username };
        await client.query(
          "INSERT INTO admins(id,username,password_hash) VALUES($1,$2,$3)",
          [admin.id, admin.username, hash],
        );
        await client.query(
          "UPDATE app_settings SET initialized=true,brand=$1::jsonb WHERE id=1",
          [JSON.stringify(body.brand)],
        );
        await client.query(
          "UPDATE setup_grants SET used_at=now() WHERE token_hash=$1",
          [tokenHash(body.token)],
        );
        return admin;
      });
      await createAdminSession(admin.id, reply);
      return { admin, participant: await getParticipant(request) };
    },
  );
  app.post(
    "/api/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = z
        .object({
          username: usernameSchema,
          password: z.string().min(1).max(128),
        })
        .parse(request.body);
      const result = await pool.query(
        "SELECT id,username,password_hash FROM admins WHERE username=$1",
        [body.username],
      );
      const admin = result.rows[0];
      const passwordValid = await verifyPassword(
        body.password,
        admin?.password_hash ?? dummyPasswordHash,
      );
      if (!admin || !passwordValid)
        throw new ApiError(401, "Неверный логин или пароль", "LOGIN");
      await createAdminSession(admin.id, reply);
      return {
        admin: { id: admin.id, username: admin.username },
        participant: await getParticipant(request),
      };
    },
  );
  app.post("/api/logout", async (request, reply) => {
    const operations = [];
    if (request.cookies[adminCookie])
      operations.push(
        pool.query("DELETE FROM admin_sessions WHERE token_hash=$1", [
          tokenHash(request.cookies[adminCookie]!),
        ]),
      );
    if (request.cookies[participantCookie])
      operations.push(
        pool.query("DELETE FROM participant_sessions WHERE token_hash=$1", [
          tokenHash(request.cookies[participantCookie]!),
        ]),
      );
    await Promise.all(operations);
    reply
      .clearCookie(adminCookie, cookieOptions)
      .clearCookie(participantCookie, cookieOptions);
    return { ok: true };
  });
  app.post("/api/account/password", async (request, reply) => {
    const admin = await requireAdmin(request);
    const body = z
      .object({
        currentPassword: z.string().min(1).max(128),
        newPassword: passwordSchema,
      })
      .parse(request.body);
    const hash = await passwordHash(body.newPassword);
    await transaction(pool, async (client) => {
      const result = await client.query(
        "SELECT password_hash FROM admins WHERE id=$1 FOR UPDATE",
        [admin.id],
      );
      if (
        !(await verifyPassword(
          body.currentPassword,
          result.rows[0].password_hash,
        ))
      )
        throw new ApiError(400, "Текущий пароль неверен", "PASSWORD");
      await client.query("UPDATE admins SET password_hash=$2 WHERE id=$1", [
        admin.id,
        hash,
      ]);
      await client.query("DELETE FROM admin_sessions WHERE admin_id=$1", [
        admin.id,
      ]);
    });
    await createAdminSession(admin.id, reply);
    return { ok: true };
  });
  app.get("/api/settings", async (request) => {
    await requireAdmin(request);
    return normalizeBrand(
      (await pool.query("SELECT brand FROM app_settings WHERE id=1")).rows[0]
        .brand,
    );
  });
  app.put("/api/settings", async (request) => {
    await requireAdmin(request);
    const brand = brandSchema.parse(request.body);
    await pool.query("UPDATE app_settings SET brand=$1::jsonb WHERE id=1", [
      JSON.stringify(brand),
    ]);
    return brand;
  });
  async function uploadImage(request: FastifyRequest) {
    const file = await request.file();
    if (!file || file.fieldname !== "file")
      throw new ApiError(400, "Выберите изображение в поле file");
    const buffer = await file.toBuffer();
    if (!buffer.length) throw new ApiError(400, "Изображение пустое");
    let extension: string | undefined, mime: string | undefined;
    if (
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ) {
      extension = "png";
      mime = "image/png";
    } else if (
      buffer.length >= 4 &&
      buffer[0] === 255 &&
      buffer[1] === 216 &&
      buffer[2] === 255 &&
      buffer.at(-2) === 255 &&
      buffer.at(-1) === 217
    ) {
      extension = "jpg";
      mime = "image/jpeg";
    } else if (
      buffer.length >= 12 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP"
    ) {
      extension = "webp";
      mime = "image/webp";
    }
    if (!extension || file.mimetype !== mime)
      throw new ApiError(
        415,
        "Загрузите PNG, JPEG или WebP. Содержимое должно соответствовать типу файла.",
        "MEDIA_TYPE",
      );
    const name = `${randomUUID()}.${extension}`;
    await writeFile(path.join(mediaDir, name), buffer, {
      flag: "wx",
      mode: 0o640,
    });
    return { url: `/media/${name}` };
  }
  app.post("/api/media", async (request) => {
    await requireAdmin(request);
    return uploadImage(request);
  });
  app.post(
    "/api/setup/media",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request) => {
      const token = request.headers["x-setup-token"];
      if (typeof token !== "string" || token.length < 20 || token.length > 200)
        throw new ApiError(
          403,
          "Введите действующий код установки",
          "SETUP_TOKEN",
        );
      return transaction(pool, async (client) => {
        // Hold the installation lock until the upload finishes so setup cannot
        // close or rotate its grant between authorization and storing a logo.
        const settings = await client.query(
          "SELECT initialized FROM app_settings WHERE id=1 FOR SHARE",
        );
        if (settings.rows[0].initialized)
          throw new ApiError(409, "Приложение уже настроено", "INITIALIZED");
        const grant = await client.query(
          "SELECT token_hash FROM setup_grants WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() FOR SHARE",
          [tokenHash(token)],
        );
        if (!grant.rowCount)
          throw new ApiError(
            403,
            "Код установки неверен или истёк. Создайте новый в консоли сервера.",
            "SETUP_TOKEN",
          );
        return uploadImage(request);
      });
    },
  );
  app.get("/api/questions", async (request) => {
    await requireAdmin(request);
    return (
      await pool.query("SELECT data FROM questions ORDER BY created_at,id")
    ).rows.map((row) => row.data);
  });
  app.get("/api/questions/export", async (request) => {
    await requireAdmin(request);
    return {
      format: "ctokodnomy-questions-v1",
      questions: (
        await pool.query("SELECT data FROM questions ORDER BY created_at,id")
      ).rows.map((row) => row.data),
    };
  });
  app.post("/api/questions/demo", async (request) => {
    await requireAdmin(request);
    const questions = createDemoQuestions();
    await transaction(pool, async (client) => {
      for (const question of questions)
        await client.query(
          "INSERT INTO questions(id,data) VALUES($1,$2::jsonb)",
          [question.id, JSON.stringify(question)],
        );
    });
    return { count: questions.length };
  });
  app.post("/api/questions", async (request) => {
    await requireAdmin(request);
    const question = mapQuestion(request.body);
    await pool.query("INSERT INTO questions(id,data) VALUES($1,$2::jsonb)", [
      question.id,
      JSON.stringify(question),
    ]);
    return question;
  });
  app.put("/api/questions/:id", async (request) => {
    await requireAdmin(request);
    const id = gameId(request).toLowerCase();
    const question = { ...mapQuestion(request.body), id };
    const result = await pool.query(
      "UPDATE questions SET data=$2::jsonb WHERE id=$1",
      [id, JSON.stringify(question)],
    );
    if (!result.rowCount) throw new ApiError(404, "Вопрос не найден");
    return question;
  });
  app.delete("/api/questions/:id", async (request) => {
    await requireAdmin(request);
    const result = await pool.query("DELETE FROM questions WHERE id=$1", [
      gameId(request),
    ]);
    if (!result.rowCount) throw new ApiError(404, "Вопрос не найден");
    return { ok: true };
  });
  app.post("/api/questions/import", async (request) => {
    await requireAdmin(request);
    const parsed = questionImportRequestSchema.safeParse(request.body);
    if (!parsed.success)
      throw new ApiError(
        400,
        questionImportIssues(parsed.error.issues)
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join("; "),
        "VALIDATION",
      );
    const body = parsed.data;
    const questions = body.questions.map(mapQuestion);
    await transaction(pool, async (client) => {
      for (const question of questions) {
        const values = [question.id, JSON.stringify(question)];
        // The wizard's confirmation applies only to these UUIDs. Checking in
        // the upsert also covers another tab inserting a UUID after preview.
        const result = body.replaceIds === undefined
          ? await client.query(
              "INSERT INTO questions(id,data) VALUES($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET data=excluded.data RETURNING id",
              values,
            )
          : await client.query(
              "INSERT INTO questions(id,data) VALUES($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE questions.id=ANY($3::uuid[]) OR questions.data=excluded.data RETURNING id",
              [...values, body.replaceIds],
            );
        if (!result.rowCount)
          throw new ApiError(
            409,
            "Библиотека изменилась. Проверьте вопросы ещё раз перед сохранением.",
            "IMPORT_CONFLICT",
          );
      }
    });
    return { count: questions.length };
  });
  app.post("/api/games", async (request) => {
    await requireAdmin(request);
    const body = z
      .object({
        title: z.string().trim().min(1).max(120),
        questionIds: z
          .array(idSchema.transform((value) => value.toLowerCase()))
          .min(1)
          .max(20),
        teams: z.tuple([teamSchema, teamSchema]),
        rules: rulesSchema.optional(),
      })
      .parse(request.body);
    if (new Set(body.questionIds).size !== body.questionIds.length)
      throw new ApiError(400, "Выберите разные вопросы для раундов");
    const state = await transaction(pool, async (client) => {
      const questionRows = await client.query(
        "SELECT id,data FROM questions WHERE id=ANY($1::uuid[])",
        [body.questionIds],
      );
      const byId = new Map<string, Question>(
        questionRows.rows.map((row) => [row.id, row.data]),
      );
      if (byId.size !== body.questionIds.length)
        throw new ApiError(400, "Один из вопросов больше не существует");
      const brand = normalizeBrand(
        (await client.query("SELECT brand FROM app_settings WHERE id=1"))
          .rows[0].brand,
      );
      const state = createGame({
        title: body.title,
        questions: body.questionIds.map((id) => byId.get(id)!),
        teams: body.teams,
        rules: body.rules,
        brand,
      });
      await client.query("INSERT INTO games(id,state) VALUES($1,$2::jsonb)", [
        state.id,
        JSON.stringify(state),
      ]);
      return state;
    });
    return hostGame(pool, state);
  });
  app.get("/api/games/:id/public", async (request) =>
    publicView(await loadGame(pool, gameId(request))),
  );
  app.get("/api/games/:id/host", async (request) => {
    await requireAdmin(request);
    return hostGame(pool, await loadGame(pool, gameId(request)));
  });
  app.get("/api/games/:id/team", async (request) => {
    const id = gameId(request),
      self = await requireParticipant(request, id);
    return teamView(await loadGame(pool, id), self, await players(pool, id));
  });
  app.get("/api/games/:id/results", async (request) => {
    const state = await loadGame(pool, gameId(request));
    if (
      state.phase !== "finished" ||
      (!state.resultsPublished && !(await getAdmin(request)))
    )
      throw new ApiError(404, "Результаты не опубликованы", "NOT_FOUND");
    return gameResults(state);
  });
  app.post("/api/games/:id/reset", async (request) => {
    const admin = await requireAdmin(request),
      id = gameId(request),
      body = commandEnvelope.omit({ command: true }).parse(request.body),
      actor = `admin:${admin.id}`,
      inputHash = createHash("sha256")
        .update(JSON.stringify({ type: "reset" }))
        .digest("hex");
    const result = await transaction(pool, async (client) => {
      const state = await loadGame(client, id, true);
      const previous = await client.query(
        "SELECT actor,input_hash FROM game_commands WHERE game_id=$1 AND request_id=$2",
        [id, body.requestId],
      );
      if (previous.rowCount) {
        if (
          previous.rows[0].actor !== actor ||
          previous.rows[0].input_hash !== inputHash
        )
          throw new ApiError(
            409,
            "Этот идентификатор уже использован для другого действия",
            "REQUEST_ID",
          );
        return { state, changed: false };
      }
      if (state.revision !== body.revision)
        throw new ApiError(
          409,
          "Игра уже изменилась. Обновите состояние и повторите действие.",
          "REVISION",
        );
      const brand = normalizeBrand(
        (await client.query("SELECT brand FROM app_settings WHERE id=1"))
          .rows[0].brand,
      );
      const updated = resetGame(state, brand);
      if (updated.revision !== state.revision + 1)
        throw new Error("Game engine reset revision invariant failed");
      await client.query("DELETE FROM participants WHERE game_id=$1", [id]);
      await client.query("DELETE FROM game_commands WHERE game_id=$1", [id]);
      await saveGame(client, updated);
      await client.query(
        "INSERT INTO game_commands(game_id,request_id,actor,input_hash) VALUES($1,$2,$3,$4)",
        [id, body.requestId, actor, inputHash],
      );
      return { state: updated, changed: true };
    });
    if (result.changed) broadcast(result.state);
    return hostGame(pool, result.state);
  });
  app.delete("/api/games/:id", async (request) => {
    await requireAdmin(request);
    const id = gameId(request),
      body = z
        .object({ revision: z.number().int().min(0) })
        .parse(request.body);
    const state = await transaction(pool, async (client) => {
      const state = await loadGame(client, id, true);
      if (state.revision !== body.revision)
        throw new ApiError(
          409,
          "Игра уже изменилась. Обновите состояние и повторите действие.",
          "REVISION",
        );
      await client.query("DELETE FROM games WHERE id=$1", [id]);
      return state;
    });
    broadcast({ ...state, revision: state.revision + 1 });
    for (const socket of sockets.get(id) ?? []) socket.close();
    return { ok: true };
  });
  app.post("/api/games/:id/results/publication", async (request) => {
    await requireAdmin(request);
    const id = gameId(request),
      body = z
        .object({
          published: z.boolean(),
          revision: z.number().int().min(0),
        })
        .parse(request.body);
    const result = await transaction(pool, async (client) => {
      const state = await loadGame(client, id, true);
      if (state.revision !== body.revision)
        throw new ApiError(
          409,
          "Игра уже изменилась. Обновите состояние и повторите действие.",
          "REVISION",
        );
      if (body.published && state.phase !== "finished")
        throw new ApiError(
          409,
          "Опубликовать результаты можно после завершения игры",
          "GAME_PHASE",
        );
      if (state.resultsPublished === body.published)
        return { state, changed: false };
      state.resultsPublished = body.published;
      state.revision += 1;
      await saveGame(client, state);
      return { state, changed: true };
    });
    if (result.changed) broadcast(result.state);
    return hostGame(pool, result.state);
  });
  app.post(
    "/api/join",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = z
        .object({
          code: z
            .string()
            .trim()
            .min(4)
            .max(24)
            .regex(/^[a-zA-Z0-9-]+$/)
            .transform((v) => v.toUpperCase()),
          name: z.string().trim().min(1).max(60),
        })
        .parse(request.body);
      const token = newToken();
      const result = await transaction(pool, async (client) => {
        const rows = await client.query(
          "SELECT state FROM games WHERE state->'teams' @> $1::jsonb FOR UPDATE",
          [JSON.stringify([{ joinCode: body.code }])],
        );
        if (rows.rowCount !== 1)
          throw new ApiError(404, "Код команды не найден", "JOIN_CODE");
        const stored = rows.rows[0].state as GameState;
        const state = normalizeGameState({
          ...stored,
          brand: normalizeBrand(stored.brand),
        });
        const team = state.teams.find((t) => t.joinCode === body.code)!;
        if (!team.joinOpen || state.phase === "finished")
          throw new ApiError(409, "Вход в эту команду закрыт", "JOIN_CLOSED");
        const count = await client.query(
          "SELECT count(*)::integer AS count FROM participants WHERE game_id=$1 AND team_id=$2",
          [state.id, team.id],
        );
        if (count.rows[0].count >= 200)
          throw new ApiError(409, "Команда заполнена");
        const participant: Participant = {
          id: randomUUID(),
          gameId: state.id,
          teamId: team.id,
          name: body.name,
          role: "player",
        };
        await client.query(
          "INSERT INTO participants(id,game_id,team_id,name,role) VALUES($1,$2,$3,$4,$5)",
          [
            participant.id,
            participant.gameId,
            participant.teamId,
            participant.name,
            participant.role,
          ],
        );
        await client.query(
          "INSERT INTO participant_sessions(token_hash,participant_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
          [tokenHash(token), participant.id],
        );
        if (request.cookies[participantCookie])
          await client.query(
            "DELETE FROM participant_sessions WHERE token_hash=$1",
            [tokenHash(request.cookies[participantCookie]!)],
          );
        state.revision += 1;
        await saveGame(client, state);
        return { state, participant };
      });
      reply.setCookie(participantCookie, token, {
        ...cookieOptions,
        maxAge: 7 * 86400,
      });
      broadcast(result.state);
      return { gameId: result.state.id, participant: result.participant };
    },
  );
  async function runCommand(
    id: string,
    actor: string,
    requestId: string,
    revision: number,
    command: GameCommand,
    validate?: (client: Transaction) => Promise<void>,
  ) {
    const inputHash = createHash("sha256")
      .update(JSON.stringify(command))
      .digest("hex");
    const result = await transaction(pool, async (client) => {
      const state = await loadGame(client, id, true);
      if (validate) await validate(client);
      const previous = await client.query(
        "SELECT actor,input_hash FROM game_commands WHERE game_id=$1 AND request_id=$2",
        [id, requestId],
      );
      if (previous.rowCount) {
        if (
          previous.rows[0].actor !== actor ||
          previous.rows[0].input_hash !== inputHash
        )
          throw new ApiError(
            409,
            "Этот идентификатор уже использован для другого действия",
            "REQUEST_ID",
          );
        return { state, changed: false };
      }
      if (state.revision !== revision)
        throw new ApiError(
          409,
          "Игра уже изменилась. Обновите состояние и повторите действие.",
          "REVISION",
        );
      const updated = applyCommand(state, command);
      if (updated.revision !== state.revision + 1)
        throw new Error("Game engine revision invariant failed");
      await saveGame(client, updated);
      await client.query(
        "INSERT INTO game_commands(game_id,request_id,actor,input_hash) VALUES($1,$2,$3,$4)",
        [id, requestId, actor, inputHash],
      );
      return { state: updated, changed: true };
    });
    if (result.changed) broadcast(result.state);
    return result.state;
  }
  app.post("/api/games/:id/commands", async (request) => {
    const admin = await requireAdmin(request),
      id = gameId(request),
      body = commandEnvelope.parse(request.body);
    const state = await runCommand(
      id,
      `admin:${admin.id}`,
      body.requestId,
      body.revision,
      body.command,
    );
    return hostGame(pool, state);
  });
  app.post("/api/games/:id/captain", async (request) => {
    await requireAdmin(request);
    const id = gameId(request),
      body = z.object({ participantId: idSchema }).parse(request.body);
    const state = await transaction(pool, async (client) => {
      const state = await loadGame(client, id, true);
      const result = await client.query(
        "SELECT team_id,role FROM participants WHERE id=$1 AND game_id=$2",
        [body.participantId, id],
      );
      if (!result.rowCount) throw new ApiError(404, "Участник не найден");
      if (result.rows[0].role === "captain") return state;
      await client.query(
        "UPDATE participants SET role='player' WHERE game_id=$1 AND team_id=$2 AND role='captain'",
        [id, result.rows[0].team_id],
      );
      await client.query("UPDATE participants SET role='captain' WHERE id=$1", [
        body.participantId,
      ]);
      state.revision += 1;
      await saveGame(client, state);
      return state;
    });
    broadcast(state);
    return hostGame(pool, state);
  });
  for (const type of ["suggest", "submit"] as const) {
    app.post(`/api/games/:id/${type}`, async (request) => {
      const id = gameId(request),
        self = await requireParticipant(request, id),
        body = participantEnvelope.parse(request.body);
      const command: GameCommand = {
        type,
        participantId: self.id,
        teamId: self.teamId,
        authorName: self.name,
        text: body.text,
      };
      const state = await runCommand(
        id,
        `participant:${self.id}`,
        body.requestId,
        body.revision,
        command,
        async (client) => {
          const participant = await client.query(
            "SELECT role FROM participants WHERE id=$1 AND game_id=$2",
            [self.id, id],
          );
          if (!participant.rowCount)
            throw new ApiError(
              403,
              "Присоединитесь к команде этой игры",
              "TEAM_REQUIRED",
            );
          if (type === "submit") {
            if (participant.rows[0]?.role !== "captain")
              throw new ApiError(
                403,
                "Итоговый ответ отправляет капитан",
                "CAPTAIN_REQUIRED",
              );
          }
        },
      );
      const currentPlayers = await players(pool, id);
      const currentSelf = currentPlayers.find((p) => p.id === self.id)!;
      return teamView(state, currentSelf, currentPlayers);
    });
  }
  app.get("/api/ws/games/:id", { websocket: true }, async (socket, request) => {
    try {
      const id = gameId(request);
      const state = await loadGame(pool, id);
      const group = sockets.get(id) ?? new Set();
      group.add(socket);
      sockets.set(id, group);
      socket.on("close", () => {
        group.delete(socket);
        if (!group.size) sockets.delete(id);
      });
      socket.on("error", () => {
        group.delete(socket);
        if (!group.size) sockets.delete(id);
      });
      socket.send(
        JSON.stringify({ type: "changed", revision: state.revision }),
      );
    } catch {
      socket.close(1008, "Game unavailable");
    }
  });
  app.addHook("onClose", async () => {
    for (const group of sockets.values())
      for (const socket of group) socket.close();
  });
  await app.register(fastifyStatic, {
    root: mediaDir,
    prefix: "/media/",
    decorateReply: false,
    index: false,
    dotfiles: "deny",
    maxAge: "7d",
  });
  const staticDir = path.resolve(options.staticDir ?? "dist/client");
  let index: string | undefined;
  if (existsSync(path.join(staticDir, "index.html"))) {
    index = await readFile(path.join(staticDir, "index.html"), "utf8");
    await app.register(fastifyStatic, {
      root: staticDir,
      prefix: "/",
      decorateReply: false,
      wildcard: false,
      index: false,
    });
  }
  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split("?")[0];
    if (
      index &&
      request.method === "GET" &&
      !pathname.startsWith("/api") &&
      !pathname.startsWith("/media/") &&
      !pathname.includes(".")
    )
      return reply.type("text/html").send(index);
    return reply
      .code(404)
      .send({ message: "Страница не найдена", code: "NOT_FOUND" });
  });
  return app;
}
