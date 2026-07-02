# DomainOps v2 — покупка, подключение и мониторинг доменов

Полностью контейнеризированная система на **Node.js + BullMQ + PostgreSQL + Redis**.

Задачи:
- покупка доменов на Namecheap;
- автоматическое подключение через Cloudflare (зона, DNS A‑запись на Keitaro, SSL/HTTPS, Bot Fight Mode);
- добавление домена в Keitaro‑трекер;
- непрерывный мониторинг (HTTP, SSL, срок регистрации) с пушами в Telegram;
- масштабируемая обработка через очереди (без блокирующих циклов).

## Архитектура

```
frontend/           React + Vite + Tailwind (UI, отдаётся через nginx)
backend/            Node.js (TypeScript, tsx)
  src/index.ts      REST API (Express)
  src/workers/      BullMQ воркеры: monitor + provision
  src/scheduler.ts  Планировщик — ставит проверки в очередь по интервалу
  src/services/     checkers, telegram, namecheap, cloudflare, keitaro, monitor, provision
  src/db/           PostgreSQL pool + схема + миграции
  data/             seed-domains.json — текущие домены
docker-compose.yml  postgres, redis, api, worker, scheduler, frontend
```

Поток «купить → подключить»:

```
UI /purchase → API /api/purchase/buy → provision queue
   → Cloudflare (зона + DNS → 178.63.149.98 + шаблон)
   → Namecheap (регистрация + NS на Cloudflare)
   → Keitaro (добавить домен)
   → домен включается в мониторинг
```

Поток мониторинга:

```
scheduler (каждые 30с) → выбирает домены, у которых истёк интервал
   → monitor queue (jobId=check:<id>, дедупликация)
   → worker: HTTP + SSL + RDAP → обновляет БД → инцидент → Telegram
```

## Быстрый старт

1. Скопируйте и заполните переменные окружения:

```bash
cp .env.example .env
# отредактируйте .env (пароль БД, ключи Namecheap/Cloudflare, Telegram)
```

2. Поднимите стек:

```bash
docker compose up -d --build
```

3. Импортируйте текущие домены и интеграции (одноразово):

```bash
docker compose run --rm api npm run seed
```

4. Откройте UI: http://localhost:8080

API доступен на `http://localhost:8080/api` (проксируется через nginx).

## Локальная разработка (без Docker)

Нужны локальные PostgreSQL и Redis.

```bash
# backend
cd backend && npm install
npm run migrate && npm run seed
npm run api        # терминал 1
npm run worker     # терминал 2
npm run scheduler  # терминал 3

# frontend
cd frontend && npm install && npm run dev
```

## Импорт присланных доменов

Список текущих доменов лежит в `backend/data/seed-domains.json` и загружается командой
`npm run seed`. Все они добавляются с `keitaro_id` (IP `178.63.149.98`), шаблоном
мониторинга `Main` (интервал 15 минут) и статусом `PENDING`; первый цикл проверок
заполнит HTTP‑код, SSL и срок регистрации. Дополнительно домены можно импортировать
через `POST /api/domains/import`.

## Ключевые эндпоинты API

| Метод | Путь | Назначение |
|------|------|-----------|
| GET  | `/api/domains` | список доменов со статусом мониторинга |
| POST | `/api/domains/import` | массовый импорт в мониторинг |
| POST | `/api/domains/:id/check` | немедленная проверка |
| GET  | `/api/integrations` | Namecheap / Cloudflare / Keitaro / группы |
| GET  | `/api/templates` | шаблоны Cloudflare |
| POST | `/api/purchase/check` | проверка доступности на Namecheap |
| POST | `/api/purchase/buy` | покупка + подключение (в очередь) |
| GET/POST | `/api/settings` | Telegram и параметры мониторинга |
| POST | `/api/settings/test-telegram` | тестовое сообщение |
| CRUD | `/api/crud/:table[/:id]` | интеграции и шаблоны |

## Управление через Makefile

```bash
make            # список команд
make rebuild    # собрать образы и поднять стек
make deploy     # git pull + пересборка + рестарт (обновление на сервере)
make seed       # импорт доменов/шаблонов/интеграций (один раз)
make ps         # статус контейнеров
make status     # сводка UP/DOWN/PENDING по доменам
make logs s=worker   # логи конкретного сервиса
make restart-app     # рестарт api+worker+scheduler
make psql       # psql-шелл в контейнере postgres
make down       # остановить (данные сохраняются)
make nuke       # ОПАСНО: удалить контейнеры и тома с данными
```

## Утилиты

Удаление macOS‑мусора (`._*`, `.DS_Store`) — актуально при работе на exFAT/сетевом диске:

```bash
./scripts/clean-appledouble.sh          # очистить корень проекта
./scripts/clean-appledouble.sh /path    # очистить конкретную папку
```

## Безопасность

`.env` содержит секреты и добавлен в `.gitignore`. Присланные ключи Namecheap/Cloudflare
рекомендуется ротировать после первого запуска.
