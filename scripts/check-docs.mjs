#!/usr/bin/env node
// Проверяет, что документация отвечает на вопросы, ради которых существует,
// а не просто присутствует в репозитории.
//
// Ловит típичный провал: README остался шаблонным, плейсхолдеры не заполнены,
// ссылки ведут в никуда.

import { readFileSync, existsSync } from "node:fs";

const CHECKS = [
  {
    file: "README.md",
    mustContain: [
      ["tutu-swipe", "название проекта"],
      ["MCP Туту", "источник данных"],
      ["discovery", "главный технический тезис"],
      ["npm install", "как запустить"],
      ["npm run check", "как проверить"],
    ],
    mustNotContain: [["{{", "незаполненные плейсхолдеры"], ["nextjs-agent-template", "остатки шаблона"]],
  },
  {
    file: "docs/architecture.md",
    mustContain: [
      ["discovery", "почему существует слой подбора направлений"],
      ["снапшот", "как решена скорость"],
      ["байесовск", "почему такая модель"],
    ],
    mustNotContain: [["{{", "незаполненные плейсхолдеры"]],
  },
  {
    file: "docs/demo-script.md",
    mustContain: [["Кадр", "раскадровка"], ["Подготовка", "что сделать до записи"]],
    mustNotContain: [["{{", "незаполненные плейсхолдеры"]],
  },
  {
    file: "docs/USER_GUIDE.md",
    mustContain: [
      ["Как составить фразу", "как сформулировать запрос"],
      ["Подписи, которые встречаются в ленте", "как читать подписи"],
      ["Лайки и дизлайки", "как работают реакции"],
      ["/help", "ссылка на инструкцию в продукте"],
    ],
    mustNotContain: [["{{", "незаполненные плейсхолдеры"]],
  },
  {
    file: "AGENTS.md",
    mustContain: [["tutu-swipe", "название проекта"], ["npm run check", "команда гейта"]],
    mustNotContain: [["{{", "незаполненные плейсхолдеры"]],
  },
];

let failed = 0;

for (const check of CHECKS) {
  if (!existsSync(check.file)) {
    console.error(`\nWHAT: ${check.file} — файл отсутствует`);
    console.error(`WHY:  документация сдаётся вместе с кодом и заменяет автора, которого не будет рядом`);
    console.error(`FIX:  создай ${check.file}`);
    failed += 1;
    continue;
  }
  const text = readFileSync(check.file, "utf8");
  for (const [needle, why] of check.mustContain) {
    if (!text.toLowerCase().includes(needle.toLowerCase())) {
      console.error(`\nWHAT: ${check.file} не объясняет: ${why}`);
      console.error(`WHY:  жюри читает проект без автора; необъяснённое считается несделанным`);
      console.error(`FIX:  добавь в ${check.file} раздел про «${needle}»`);
      failed += 1;
    }
  }
  for (const [needle, why] of check.mustNotContain) {
    if (text.includes(needle)) {
      console.error(`\nWHAT: ${check.file} содержит ${why} («${needle}»)`);
      console.error(`WHY:  шаблонный текст в сданном проекте выглядит как незаконченная работа`);
      console.error(`FIX:  замени или удали`);
      failed += 1;
    }
  }
}

if (failed > 0) {
  console.error(`\nПроблем в документации: ${failed}`);
  process.exit(1);
}
console.log(`Документация проверена: ${CHECKS.length} файлов, плейсхолдеров нет.`);
