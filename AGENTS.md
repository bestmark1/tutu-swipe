<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# tutu-swipe — свайп-подбор путешествий поверх MCP Туту

Свободная фраза → лента готовых поездок (дорога и жильё одним пакетом) → обучение на реакциях внутри сессии → подборка по ссылке → переход на Туту. Проект для хакатона Туту, защита 19–20 августа 2026.

## Стек

- Next.js 16 (App Router, Turbopack) + React 19, TypeScript 5, Tailwind 4, Node ≥22
- Тесты: Vitest + Testing Library (`tests/`)
- Внешние: MCP Туту (`https://mcp.tutu.ru/mcp`, read-only поиск) и модель для запасного разбора запроса. Хранилищ и других платных сервисов нет — состояние живёт на клиенте, подборка в ссылке

## Команды

```bash
npm run dev          # dev-сервер (localhost:3000)
npm run check        # уровни 1-2: типы + линт + тесты + границы + audit фич
npm run smoke        # уровень 3: сборка, запуск, критические маршруты
npm run features     # состояние списка фич
npm test             # тесты
```

`npm run check` — обязательный гейт перед любым коммитом.

## Где искать

| Что нужно | Где |
|---|---|
| Карта всех документов | `PROJECT_INDEX.md` |
| Что делать дальше | `npm run features next`, `SPEC_PLAN/phase-registry.md` |
| Требования и критерии приёмки AC1–AC38 | `SPEC_PLAN/PRD.md` |
| Слои, контракты, бюджет времени | `SPEC_PLAN/ARCHITECTURE.md` |
| Правила, которые нельзя нарушать | `SPEC_PLAN/CONSTITUTION.md` |
| Как исполняются фазы, ревью и список фич | `docs/EXECUTION_RULES.md` |
| Неочевидное поведение внешних систем | `docs/surprises.md` |
| Состояние работ между сессиями | `PROGRESS.md`, `HANDOFF.md` |

## Связанные репозитории

Происходит из шаблона `bestmark1/nextjs-agent-template`. Обратной синхронизации нет: улучшения инфраструктуры переносятся вручную.

## Запрещено без разрешения владельца

1. Подключать платные сторонние сервисы к аккаунту (Redis, модели, интеграции Vercel).
2. Публиковать репозиторий или деплой.
3. Помечать фичу `passing` без запуска её команды верификации.
4. Коммитить секреты в любом виде, включая фикстуры и примеры.
5. Ослаблять правила `SPEC_PLAN/CONSTITUTION.md` ради прохождения гейта.
6. Выполнять работу из будущих фаз — см. `docs/EXECUTION_RULES.md`.

Секреты — только в `.env.local` (шаблон: `.env.local.example`), в код не попадают.
