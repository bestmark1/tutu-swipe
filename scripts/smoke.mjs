#!/usr/bin/env node
// Уровень 3: сквозная проверка. Собирает приложение, поднимает его,
// дожидается готовности и дёргает критические маршруты.
//
// Ловит то, что не видят юнит-тесты: приложение не собирается, не стартует,
// страница падает на стыке компонентов. Это и есть рантайм-сигналы —
// «запустилось и достигло готовности» и «критический путь отработал».
//
// Сервер гасится на любом пути выхода — включая падение проверки, — поэтому
// после прогона не остаётся висящих процессов на порту.

import { spawn, spawnSync } from "node:child_process";

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const READY_TIMEOUT_MS = 60_000;

// Критические пути проекта. Добавляй сюда маршруты по мере появления фич:
// проверяется код ответа и то, что в HTML есть ожидаемый маркер.
const ROUTES = [
  {
    path: "/",
    status: 307,
    location: "/swipe",
    request: { redirect: "manual" },
  },
  { path: "/swipe", status: 200, contains: "Лента поездок" },
  { path: "/help", status: 200, contains: "Как описать поездку" },
  {
    path: "/api/search",
    status: 400,
    contains: '"code":"empty_input"',
    request: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "" }),
    },
  },
];

let server = null;

// Идемпотентна: безопасно вызывать повторно и когда сервер не запускался.
function cleanup() {
  if (!server) return;
  const running = server;
  server = null;

  try {
    // Гасим всю группу процессов: next start порождает дочерние.
    process.kill(-running.pid, "SIGTERM");
  } catch {
    try {
      running.kill("SIGTERM");
    } catch {
      // процесс уже завершился
    }
  }
}

// Очистка обязана произойти на любом пути выхода, включая fail().
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

function fail(what, why, fix) {
  console.error(`\nERROR: ${what}`);
  console.error(`WHY:   ${why}`);
  console.error(`FIX:   ${fix}\n`);
  cleanup();
  process.exit(1);
}

function build() {
  console.log("Сборка…");
  const result = spawnSync("npx next build", {
    shell: true,
    encoding: "utf8",
    timeout: 10 * 60 * 1000,
  });

  if (result.status !== 0) {
    console.error(`${result.stdout ?? ""}${result.stderr ?? ""}`.trim());
    fail(
      "приложение не собирается",
      "уровень 3 начинается со сборки: непособираемое приложение не может быть проверено сквозным сценарием",
      "почини ошибки сборки из вывода выше и запусти npm run smoke снова"
    );
  }
}

async function waitForReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(BASE, { signal: AbortSignal.timeout(3000) });
      if (response.status > 0) return;
    } catch {
      // сервер ещё поднимается — пробуем снова
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  fail(
    `приложение не ответило за ${READY_TIMEOUT_MS / 1000} с после запуска`,
    "сборка прошла, но процесс не достиг состояния готовности — обычно это падение при старте или занятый порт",
    `запусти npx next start -p ${PORT} вручную и посмотри вывод`
  );
}

async function probeRoutes() {
  const failures = [];

  for (const route of ROUTES) {
    let response;
    try {
      response = await fetch(BASE + route.path, {
        ...route.request,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      failures.push(`${route.path}: запрос не выполнен (${error.message})`);
      continue;
    }

    if (response.status !== route.status) {
      failures.push(
        `${route.path}: код ${response.status}, ожидался ${route.status}`
      );
      continue;
    }

    if (route.location && response.headers.get("location") !== route.location) {
      failures.push(
        `${route.path}: Location ${response.headers.get("location")}, ожидался ${route.location}`
      );
      continue;
    }

    const body = await response.text();
    if (route.contains && !body.includes(route.contains)) {
      failures.push(
        `${route.path}: в ответе нет ожидаемого фрагмента "${route.contains}"`
      );
      continue;
    }

    console.log(`ok  ${route.path}`);
  }

  return failures;
}

async function main() {
  build();

  console.log(`Запуск на порту ${PORT}…`);
  server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    stdio: "ignore",
    detached: true,
  });

  try {
    await waitForReady();
    const failures = await probeRoutes();

    if (failures.length > 0) {
      for (const line of failures) console.error(`FAIL ${line}`);
      fail(
        `критические маршруты не прошли проверку: ${failures.length}`,
        "приложение поднялось, но сквозной путь работает не так, как ожидается — юнит-тесты этот класс дефектов не ловят",
        "открой упавший маршрут локально (npm run dev) и почини поведение; список маршрутов — в ROUTES в scripts/smoke.mjs"
      );
    }

    console.log(`\nSmoke пройден: ${ROUTES.length} маршрутов.`);
  } finally {
    cleanup();
  }
}

await main();
