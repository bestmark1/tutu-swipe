#!/usr/bin/env node
// Архитектурные границы как исполняемая проверка, а не строчка в документе.
//
// Правило ниже — рабочий пример под Next.js. Добавляй свои правила проекта
// в массив RULES: каждое правило обязано объяснять агенту, как чинить,
// а не просто ставить красный крест.

import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

const RULES = [
  {
    name: "секреты не читаются в клиентских компонентах",
    files: "src/**/*.{ts,tsx}",
    check(source) {
      if (!/^\s*["']use client["']/m.test(source)) return null;

      // В браузер попадают только переменные с префиксом NEXT_PUBLIC_.
      const match = source.match(/process\.env\.(?!NEXT_PUBLIC_)([A-Z0-9_]+)/);
      return match ? match[1] : null;
    },
    why: "клиентский компонент собирается в браузерный бандл: любая переменная без префикса NEXT_PUBLIC_ либо утечёт пользователю, либо окажется undefined",
    fix: "перенеси чтение переменной в серверный компонент или route handler и передай результат пропсами; если значение действительно публичное — переименуй его в NEXT_PUBLIC_*",
  },
  {
    name: "в исходниках не остаётся отладочного кода",
    files: "src/**/*.{ts,tsx}",
    check(source) {
      // console.error и console.warn легитимны — это обработка ошибок.
      const match = source.match(/\bdebugger\b|\bconsole\.log\s*\(/);
      return match ? match[0].replace(/\s*\($/, "") : null;
    },
    why: "отладочные вызовы уезжают в продакшен, шумят в консоли пользователя и иногда печатают в браузер данные, которых там быть не должно",
    fix: "удали вызов; если лог нужен постоянно — используй console.error или console.warn для настоящих ошибок",
  },
];

let violations = 0;

for (const rule of RULES) {
  const files = globSync(rule.files, { exclude: ["**/node_modules/**"] });

  for (const file of files) {
    const detail = rule.check(readFileSync(file, "utf8"));
    if (!detail) continue;

    violations += 1;
    console.error(`\nERROR: ${file} — ${rule.name} (${detail})`);
    console.error(`WHY:   ${rule.why}`);
    console.error(`FIX:   ${rule.fix}`);
  }
}

if (violations > 0) {
  console.error(`\nНарушений архитектурных границ: ${violations}\n`);
  process.exit(1);
}

console.log(`Границы соблюдены (правил проверено: ${RULES.length}).`);
