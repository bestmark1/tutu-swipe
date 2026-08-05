#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

import {
  RULES,
  createBoundaryChecker,
  formatViolation,
} from "./boundary-rules.mjs";

const checker = createBoundaryChecker();

let violations = 0;

for (const rule of RULES) {
  const files = globSync(rule.files, { exclude: ["**/node_modules/**"] });

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const detail = checker.check(rule, file, source);
    if (!detail) continue;

    violations += 1;
    console.error(`\n${formatViolation(rule, file, detail)}`);
  }
}

if (violations > 0) {
  console.error(`\nНарушений архитектурных границ: ${violations}\n`);
  process.exit(1);
}

console.log(`Границы соблюдены (правил проверено: ${RULES.length}).`);
