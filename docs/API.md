# Контракт API первой версии

Все пути начинаются с `/api`. Ответы JSON. Ошибки `{message: string, code?: string}` с соответствующим HTTP-статусом. Авторизация через HttpOnly cookies, все изменяющие запросы проверяют Origin при его наличии. Типы: `shared/types.ts`.

- `GET /site` → SiteInfo (только публичные сведения).
- `GET /me` → Me.
- `POST /setup` `{token,username,password,brand}` → Me; после инициализации 409. Токен создаётся CLI и имеет срок жизни.
- `POST /login` `{username,password}` → Me; `POST /logout` → `{ok:true}`.
- `POST /account/password` `{currentPassword,newPassword}` → `{ok:true}`.
- `GET /settings` → Brand (admin); `PUT /settings` Brand → Brand.
- `POST /media` multipart поле `file` → `{url}` (admin). PNG/JPEG/WebP, не более 2 MB; сигнатура проверяется.
- `GET /questions` → Question[] (admin); `POST /questions` Question без обязательного id → Question.
- `POST /questions/demo` → `{count}` (admin): добавляет три явно помеченных демонстрационных вопроса. Их ответы находятся только на сервере, а не в клиентской сборке.
- `PUT /questions/:id` Question → Question; `DELETE /questions/:id` → `{ok:true}`.
- `GET /questions/export` → `{format:'ctokodnomy-questions-v1',questions:Question[]}`.
- `POST /questions/import` `{format:'ctokodnomy-questions-v1',questions:Question[]}` → `{count}`; атомарно и с валидацией.
- `POST /games` `{title,questionIds:string[],teams:[{name,color},{name,color}],rules?:Rules}` → HostGame; снимок вопросов и бренда.
- `GET /games/:id/public` → PublicGame; `GET /games/:id/host` → HostGame (admin).
- `GET /games/:id/team` → TeamGame (participant в этой партии).
- `POST /join` `{code,name}` → `{gameId,participant:Participant}`; код относится к конкретной команде. Создаёт cookie участника.
- `POST /games/:id/commands` CommandRequest → HostGame (admin).
- `POST /games/:id/captain` `{participantId}` → HostGame (admin); снимает роль с прежнего капитана этой команды.
- `POST /games/:id/suggest` `{text,requestId,revision}` → TeamGame (участник команды хода).
- `POST /games/:id/submit` `{text,requestId,revision}` → TeamGame (капитан команды хода).
- `GET /ws/games/:id` WebSocket отправляет только `{type:'changed',revision:number}`. Клиент после события запрашивает своё представление. Секретное состояние через WS не передаётся. Доступ публичный, поскольку событие не содержит текстов, кодов и ответов.
- `GET /health` → `{ok:true}` после проверки подключения к БД; вне API — `/health` также доступен.

Повторный requestId не повторяет действие. Несовпадение revision — 409; клиент обновляет состояние и показывает сообщение. Номер revision и применение команды меняются атомарно с сохранением БД. Набор демовопросов помечается isDemo, добавляется только по явному действию администратора; реальным опросом не называется.
