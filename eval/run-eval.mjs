#!/usr/bin/env node
// Прогон evals: score, heatmap по категориям, ненулевой код при провале.
//
// Отдельно от `npm run check`: стоит денег и требует ключей провайдера.
// Обязателен перед правкой промптов, сменой модели и деплоем изменений,
// затрагивающих выход LLM.

import { readFileSync } from "node:fs";
import path from "node:path";

const CASES = path.resolve(process.cwd(), "eval/fixtures/cases.json");
const REGRESSIONS = path.resolve(process.cwd(), "eval/fixtures/regressions.json");

function fail(what, why, fix) {
  console.error(`\nERROR: ${what}`);
  console.error(`WHY:   ${why}`);
  console.error(`FIX:   ${fix}\n`);
  process.exit(1);
}

// Ассерты для случаев с проверяемым контрактом. Для размытых выходов
// (перевод, генерация текста) замени на свою функцию оценки.
function assertOutput(output, expect) {
  if (expect.equals !== undefined) return output.trim() === expect.equals.trim();
  if (expect.contains !== undefined) return output.includes(expect.contains);
  if (expect.matches !== undefined) return new RegExp(expect.matches).test(output);
  return false;
}

function loadCases() {
  const main = JSON.parse(readFileSync(CASES, "utf8"));
  const regressions = JSON.parse(readFileSync(REGRESSIONS, "utf8"));

  const cases = [
    ...main.cases,
    // Кейсы из цикла обратной связи помечаются, чтобы было видно,
    // сколько реальных провалов уже зафиксировано.
    ...regressions.cases.map((c) => ({ ...c, tag: c.tag ?? "regression" })),
  ];

  return { threshold: main.threshold ?? 0.85, cases };
}

async function main() {
  const { CONFIGURED, runCase } = await import("./run-case.mjs");

  if (!CONFIGURED) {
    console.log(
      "Evals не настроены — прогон пропущен.\n" +
        "Нужны ли они этому проекту, смотри в eval/README.md:\n" +
        "  выход LLM = ценность продукта → нужны evals\n" +
        "  LLM с проверяемым контрактом  → хватит обычных тестов"
    );
    process.exit(0);
  }

  const { threshold, cases } = loadCases();

  if (cases.length === 0) {
    fail(
      "набор кейсов пуст",
      "score по пустому набору не значит ничего",
      "добавь кейсы в eval/fixtures/cases.json"
    );
  }

  const failures = [];
  const byTag = new Map();

  for (const testCase of cases) {
    const tag = testCase.tag ?? "без категории";
    if (!byTag.has(tag)) byTag.set(tag, { passed: 0, failed: 0 });

    let output;
    try {
      output = await runCase(testCase.input);
    } catch (error) {
      output = `<ошибка прогона: ${error.message}>`;
    }

    const ok = assertOutput(String(output), testCase.expect);
    byTag.get(tag)[ok ? "passed" : "failed"] += 1;
    if (!ok) failures.push({ testCase, output });
  }

  const passed = cases.length - failures.length;
  const score = passed / cases.length;

  console.log(`\nScore: ${(score * 100).toFixed(1)}% (${passed}/${cases.length})`);
  console.log(`Порог: ${(threshold * 100).toFixed(1)}%\n`);

  // Heatmap: где именно рассыпается — по нему приоритизируются работы.
  console.log("Категория                       ok   fail");
  for (const [tag, counts] of byTag) {
    console.log(
      `${tag.padEnd(30)} ${String(counts.passed).padStart(3)} ${String(counts.failed).padStart(6)}`
    );
  }

  if (failures.length > 0) {
    console.log("\nПровалившиеся кейсы:");
    for (const { testCase, output } of failures) {
      console.log(`\n  ${testCase.id} [${testCase.tag ?? "—"}]`);
      console.log(`  вход:    ${JSON.stringify(testCase.input)}`);
      console.log(`  ожидали: ${JSON.stringify(testCase.expect)}`);
      console.log(`  вышло:   ${String(output).slice(0, 200)}`);
      if (testCase.note) console.log(`  сложность: ${testCase.note}`);
    }
  }

  if (score < threshold) {
    fail(
      `score ${(score * 100).toFixed(1)}% ниже порога ${(threshold * 100).toFixed(1)}%`,
      "качество выхода LLM просело — тесты этот класс регрессий не ловят, они видны только здесь",
      "посмотри heatmap выше: чините категорию с наибольшим числом fail. Если порог перестал соответствовать реальности, меняй его отдельным коммитом с обоснованием"
    );
  }

  console.log(`\nEval пройден.`);
}

await main();
