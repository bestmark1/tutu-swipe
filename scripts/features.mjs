#!/usr/bin/env node
// Список фич — примитив harness'а, а не документ.
//
// Состояние фичи меняет ТОЛЬКО этот скрипт, и только по результату запуска
// команды верификации. Агент не может объявить фичу готовой — он может лишь
// попросить проверить. `audit` перезапускает верификацию всех passing-фич,
// поэтому статус, выставленный без реальной проверки, ловится в CI.
//
// Граница доверия: команды берутся из docs/features.json — файла, лежащего в
// самом репозитории. Кто может его править, тот и так правит любой код проекта,
// поэтому shell здесь не расширяет поверхность атаки. Внешний ввод сюда
// не попадает никогда.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const FILE = path.resolve(process.cwd(), "docs/features.json");
const STATES = ["not_started", "active", "blocked", "passing"];
const VERIFY_TIMEOUT_MS = 10 * 60 * 1000;

function load() {
  return JSON.parse(readFileSync(FILE, "utf8"));
}

function save(data) {
  writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n");
}

// Сообщение об ошибке для агента: что сломалось, почему, как чинить.
function fail(what, why, fix) {
  console.error(`\nERROR: ${what}`);
  console.error(`WHY:   ${why}`);
  console.error(`FIX:   ${fix}\n`);
  process.exit(1);
}

function find(data, id) {
  const feature = data.features.find((f) => f.id === id);
  if (!feature) {
    fail(
      `фича ${id} не найдена в docs/features.json`,
      'id берётся из поля "id" записи фичи',
      "посмотри доступные: node scripts/features.mjs list"
    );
  }
  return feature;
}

function runVerification(feature) {
  const result = spawnSync(feature.verification, {
    shell: true,
    encoding: "utf8",
    timeout: VERIFY_TIMEOUT_MS,
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { ok: result.status === 0, output };
}

function list() {
  const data = load();
  const icons = { passing: "✓", active: "▶", blocked: "✗", not_started: "·" };

  for (const f of data.features) {
    console.log(`${icons[f.state]} ${f.id}  ${f.state.padEnd(11)} ${f.behavior}`);
  }

  const left = data.features.filter((f) => f.state !== "passing").length;
  console.log(
    `\n${data.features.length - left}/${data.features.length} passing.` +
      (left === 0 ? " Проект завершён." : ` Осталось: ${left}.`)
  );
}

function next() {
  const data = load();
  const active = data.features.find((f) => f.state === "active");
  if (active) {
    console.log(`Уже в работе: ${active.id} — ${active.behavior}`);
    return;
  }

  const candidate = data.features.find(
    (f) => f.state === "not_started" || f.state === "blocked"
  );
  if (!candidate) {
    console.log("Свободных фич нет — все passing.");
    return;
  }

  console.log(`Следующая: ${candidate.id} — ${candidate.behavior}`);
  console.log(`Взять в работу: node scripts/features.mjs start ${candidate.id}`);
}

function start(id) {
  const data = load();
  const feature = find(data, id);

  if (feature.state === "passing") {
    fail(
      `${id} уже passing — состояние необратимо`,
      "фича с пройденной верификацией не возвращается в работу",
      "если поведение изменилось, заведи новую фичу вместо переоткрытия старой"
    );
  }

  const active = data.features.find((f) => f.state === "active" && f.id !== id);
  if (active) {
    fail(
      `нельзя начать ${id}: уже активна ${active.id}`,
      "одновременно в работе может быть только одна фича",
      `доведи ${active.id} до passing: node scripts/features.mjs verify ${active.id}`
    );
  }

  feature.state = "active";
  save(data);
  console.log(`${id} → active`);
  console.log(`Проверка: ${feature.verification}`);
}

function verify(id) {
  const data = load();
  const feature = find(data, id);

  if (feature.state === "not_started") {
    fail(
      `${id} ещё не взята в работу`,
      "верификация запускается только для активной фичи",
      `сначала: node scripts/features.mjs start ${id}`
    );
  }

  console.log(`Проверяю ${id}: ${feature.verification}\n`);
  const result = runVerification(feature);

  if (!result.ok) {
    feature.state = "blocked";
    save(data);
    console.error(result.output);
    fail(
      `верификация ${id} не прошла — состояние blocked`,
      `команда завершилась с ненулевым кодом: ${feature.verification}`,
      "почини причину из вывода выше и запусти проверку снова"
    );
  }

  feature.state = "passing";
  feature.evidence = `verified ${new Date().toISOString()}`;
  save(data);
  console.log(`${id} → passing`);

  if (data.requireReview && feature.review?.verdict !== "approved") {
    console.log(
      `\nМашина сказала «работает». Осталось ревью — его выносит ОТДЕЛЬНЫЙ агент,` +
        `\nне тот, кто писал код. Контракт вывода — в AGENTS.md.` +
        `\n  node scripts/features.mjs review ${id} approved <кто> "<заметки>"`
    );
  }
}

// Вердикт ревьюера. Выносит отдельный агент со свежим контекстом:
// самооценка исполнителя доказательством не считается.
function review(id, verdict, by, notes) {
  const data = load();
  const feature = find(data, id);

  if (verdict !== "approved" && verdict !== "rejected") {
    fail(
      `неизвестный вердикт "${verdict}"`,
      "допустимы только approved и rejected — промежуточных оценок нет",
      `node scripts/features.mjs review ${id} approved <кто> "<заметки>"`
    );
  }

  if (!by || !notes) {
    fail(
      "не указан ревьюер или заметки",
      'вердикт без автора и обоснования неотличим от самооценки; "выглядит хорошо" не принимается',
      `node scripts/features.mjs review ${id} ${verdict} code-reviewer "что проверено и что найдено"`
    );
  }

  feature.review = {
    verdict,
    by,
    notes,
    date: new Date().toISOString(),
  };

  if (verdict === "rejected" && feature.state === "passing") {
    feature.state = "active";
  }

  save(data);
  console.log(`${id}: ревью ${verdict} (${by})`);
  if (verdict === "rejected") console.log(`${id} → active`);
}

// Перепроверяет всё, что помечено passing. Гоняется в CI, поэтому статус,
// выставленный руками без реальной проверки, обнаруживается здесь.
function audit() {
  const data = load();

  const badState = data.features.find((f) => !STATES.includes(f.state));
  if (badState) {
    fail(
      `у фичи ${badState.id} недопустимое состояние "${badState.state}"`,
      `допустимы только: ${STATES.join(", ")}`,
      "верни корректное состояние или запусти верификацию заново"
    );
  }

  const actives = data.features.filter((f) => f.state === "active");
  if (actives.length > 1) {
    fail(
      `активных фич больше одной: ${actives.map((f) => f.id).join(", ")}`,
      "одновременно в работе может быть только одна фича",
      "оставь одну активную, остальные верни в not_started"
    );
  }

  const passing = data.features.filter((f) => f.state === "passing");

  if (data.requireReview) {
    const unreviewed = passing.filter((f) => f.review?.verdict !== "approved");
    if (unreviewed.length > 0) {
      fail(
        `passing без одобренного ревью: ${unreviewed.map((f) => f.id).join(", ")}`,
        "машинная верификация подтверждает, что код работает, но не то, что он делает задуманное — этот слой выносит отдельный агент",
        `запусти ревью силами субагента и запиши вердикт: node scripts/features.mjs review ${unreviewed[0].id} approved <кто> "<заметки>"`
      );
    }
  }

  const broken = [];

  for (const feature of passing) {
    process.stdout.write(`audit ${feature.id} … `);
    const result = runVerification(feature);
    console.log(result.ok ? "ok" : "FAIL");
    if (!result.ok) broken.push({ feature, output: result.output });
  }

  if (broken.length > 0) {
    for (const { feature, output } of broken) {
      console.error(`\n--- ${feature.id}: ${feature.behavior} ---`);
      console.error(output);
    }
    fail(
      `${broken.length} фич помечены passing, но верификация не проходит: ` +
        broken.map((b) => b.feature.id).join(", "),
      "статус passing означает, что команда верификации возвращает 0 — " +
        "либо это регрессия, либо статус выставили без запуска проверки",
      'почини поведение или, если фича не готова, верни ей state "active"'
    );
  }

  console.log(`\nAudit пройден: ${passing.length} passing-фич подтверждены.`);
}

const [command, arg, ...rest] = process.argv.slice(2);

if (command === "list") list();
else if (command === "next") next();
else if (command === "start") start(arg);
else if (command === "verify") verify(arg);
else if (command === "review") review(arg, rest[0], rest[1], rest[2]);
else if (command === "audit") audit();
else {
  console.log(`Список фич — состояние меняется только через этот скрипт.

  node scripts/features.mjs list         состояния всех фич
  node scripts/features.mjs next         какую фичу брать следующей
  node scripts/features.mjs start <id>   взять в работу (одна за раз)
  node scripts/features.mjs verify <id>  запустить верификацию и обновить состояние
  node scripts/features.mjs review <id> approved|rejected <кто> "<заметки>"
                                        вердикт ревьюера (отдельный агент)
  node scripts/features.mjs audit        перепроверить все passing (гоняется в CI)
`);
  process.exit(command ? 1 : 0);
}
