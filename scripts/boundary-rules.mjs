import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

function normalizePath(file) {
  return path.posix.normalize(file.replaceAll("\\", "/")).replace(/^\.\//, "");
}

function isInLayer(file, layer) {
  const normalized = normalizePath(file);
  return (
    normalized === `src/lib/${layer}` ||
    normalized.startsWith(`src/lib/${layer}/`)
  );
}

function isRankingImplementation(file) {
  if (!isInLayer(file, "ranking")) return false;

  const withoutExtension = normalizePath(file).replace(
    /\.(?:[cm]?[jt]sx?)$/,
    "",
  );
  return withoutExtension !== "src/lib/ranking/interface";
}

function scriptKind(file) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function parseSource(source, file) {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
}

function stringLiteralValue(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  return null;
}

export function collectModuleSpecifiers(source, file = "source.ts") {
  const sourceFile = parseSource(source, file);
  const specifiers = [];

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    ) {
      const value = stringLiteralValue(node.moduleSpecifier);
      if (value) specifiers.push(value);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression
    ) {
      const value = stringLiteralValue(node.moduleReference.expression);
      if (value) specifiers.push(value);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || isRequire) {
        const value = stringLiteralValue(node.arguments[0]);
        if (value) specifiers.push(value);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function wildcardMatch(pattern, value) {
  const star = pattern.indexOf("*");
  if (star === -1) return pattern === value ? [""] : null;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!value.startsWith(prefix) || !value.endsWith(suffix)) return null;
  return [value.slice(prefix.length, value.length - suffix.length)];
}

function applyAliases(specifier, aliases) {
  for (const alias of aliases) {
    const captures = wildcardMatch(alias.pattern, specifier);
    if (!captures) continue;

    return alias.targets.map((target) =>
      normalizePath(target.replace("*", captures[0])),
    );
  }
  return [];
}

export function loadTsconfigAliases(projectRoot = process.cwd()) {
  const configFile = path.join(projectRoot, "tsconfig.json");
  if (!existsSync(configFile)) return [];

  const loaded = ts.readConfigFile(configFile, ts.sys.readFile);
  if (loaded.error) return [];

  const compilerOptions = loaded.config.compilerOptions ?? {};
  const baseDirectory = path.resolve(
    path.dirname(configFile),
    compilerOptions.baseUrl ?? ".",
  );

  return Object.entries(compilerOptions.paths ?? {}).map(
    ([pattern, targets]) => ({
      pattern,
      targets: targets.map((target) =>
        normalizePath(
          path.relative(projectRoot, path.resolve(baseDirectory, target)),
        ),
      ),
    }),
  );
}

function possibleSourceFiles(target) {
  const extension = path.posix.extname(target);
  if (SOURCE_EXTENSIONS.includes(extension)) return [target];

  return [
    target,
    ...SOURCE_EXTENSIONS.map((candidate) => `${target}${candidate}`),
    ...SOURCE_EXTENSIONS.map((candidate) =>
      path.posix.join(target, `index${candidate}`),
    ),
  ];
}

function importTargets(specifier, importer, aliases) {
  if (specifier.startsWith(".")) {
    return [normalizePath(path.posix.join(path.posix.dirname(importer), specifier))];
  }
  return applyAliases(specifier, aliases);
}

export function createBoundaryChecker({
  projectRoot = process.cwd(),
  aliases = loadTsconfigAliases(projectRoot),
} = {}) {
  function check(rule, file, source, additionalFiles = {}) {
    const normalizedFile = normalizePath(file);
    const memoryFiles = new Map(
      Object.entries(additionalFiles).map(([name, contents]) => [
        normalizePath(name),
        contents,
      ]),
    );
    memoryFiles.set(normalizedFile, source);

    function readProjectFile(projectFile) {
      const normalized = normalizePath(projectFile);
      if (memoryFiles.has(normalized)) return memoryFiles.get(normalized);

      const absolute = path.resolve(projectRoot, normalized);
      if (!absolute.startsWith(`${path.resolve(projectRoot)}${path.sep}`)) {
        return null;
      }
      return existsSync(absolute) && statSync(absolute).isFile()
        ? readFileSync(absolute, "utf8")
        : null;
    }

    function resolveImport(specifier, importer) {
      const targets = importTargets(specifier, importer, aliases);
      if (targets.length === 0) return null;

      for (const target of targets) {
        for (const candidate of possibleSourceFiles(target)) {
          const importedSource = readProjectFile(candidate);
          if (importedSource !== null) {
            return { path: candidate, source: importedSource };
          }
        }
      }

      return { path: targets[0], source: null };
    }

    return rule.check(source, {
      file: normalizedFile,
      resolveImport,
    });
  }

  return { check };
}

function findForbiddenDependency(source, context, isForbidden) {
  const visited = new Set([context.file]);

  function walk(currentSource, currentFile, chain) {
    for (const specifier of collectModuleSpecifiers(currentSource, currentFile)) {
      const resolved = context.resolveImport(specifier, currentFile);
      if (!resolved) continue;

      const nextChain = [...chain, resolved.path];
      if (isForbidden(resolved.path)) return nextChain;

      if (resolved.source === null || visited.has(resolved.path)) continue;
      visited.add(resolved.path);
      const nested = walk(resolved.source, resolved.path, nextChain);
      if (nested) return nested;
    }
    return null;
  }

  const chain = walk(source, context.file, [context.file]);
  return chain ? chain.join(" -> ") : null;
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function rootIdentifier(expression) {
  let current = unwrapExpression(expression);
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    current = unwrapExpression(current.expression);
  }
  return ts.isIdentifier(current) ? current.text : null;
}

function isAssignmentOperator(kind) {
  return (
    kind >= ts.SyntaxKind.FirstAssignment &&
    kind <= ts.SyntaxKind.LastAssignment
  );
}

function findGlobalThisWrite(sourceFile) {
  let detail = null;

  function visit(node) {
    if (detail) return;

    if (
      ts.isBinaryExpression(node) &&
      isAssignmentOperator(node.operatorToken.kind) &&
      rootIdentifier(node.left) === "globalThis"
    ) {
      detail = node.left.getText(sourceFile);
      return;
    }

    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      rootIdentifier(node.operand) === "globalThis"
    ) {
      detail = node.operand.getText(sourceFile);
      return;
    }

    if (
      ts.isDeleteExpression(node) &&
      rootIdentifier(node.expression) === "globalThis"
    ) {
      detail = node.expression.getText(sourceFile);
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return detail;
}

function collectModuleDeclarations(sourceFile) {
  const declarations = [];

  function visit(node) {
    if (
      node !== sourceFile &&
      (ts.isFunctionLike(node) || ts.isClassLike(node))
    ) {
      return;
    }
    if (ts.isVariableDeclaration(node)) declarations.push(node);
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return declarations;
}

const MUTATING_METHODS = new Set([
  "add",
  "clear",
  "copyWithin",
  "delete",
  "fill",
  "pop",
  "push",
  "reverse",
  "set",
  "shift",
  "sort",
  "splice",
  "unshift",
]);

function variableIsMutated(sourceFile, variableName) {
  let mutated = false;

  function visit(node) {
    if (mutated) return;

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      MUTATING_METHODS.has(node.expression.name.text) &&
      rootIdentifier(node.expression.expression) === variableName
    ) {
      mutated = true;
      return;
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(sourceFile) === "Object" &&
      node.expression.name.text === "assign" &&
      node.arguments[0] &&
      rootIdentifier(node.arguments[0]) === variableName
    ) {
      mutated = true;
      return;
    }

    if (
      ts.isBinaryExpression(node) &&
      isAssignmentOperator(node.operatorToken.kind) &&
      rootIdentifier(node.left) === variableName &&
      !ts.isIdentifier(unwrapExpression(node.left))
    ) {
      mutated = true;
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return mutated;
}

function mutableContainerKind(initializer, sourceFile, variableName) {
  const expression = unwrapExpression(initializer);
  if (
    ts.isNewExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    (expression.expression.text === "Map" || expression.expression.text === "Set")
  ) {
    return expression.expression.text;
  }

  if (ts.isArrayLiteralExpression(expression)) {
    if (expression.elements.length === 0 || variableIsMutated(sourceFile, variableName)) {
      return "Array";
    }
  }

  if (ts.isObjectLiteralExpression(expression)) {
    if (expression.properties.length === 0 || variableIsMutated(sourceFile, variableName)) {
      return "Object";
    }
  }

  return null;
}

function hasUseClientDirective(sourceFile) {
  return sourceFile.statements.some(
    (statement) =>
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression) &&
      statement.expression.text === "use client",
  );
}

function findCrossRequestState(source, file) {
  const sourceFile = parseSource(source, file);
  // В Next.js модуль без явной client-границы потенциально исполняется на
  // сервере. Наследуемые client-imports статически без полного графа сборки не
  // различаются, поэтому .client.* и "use client" — честная граница проверки.
  if (hasUseClientDirective(sourceFile) || /\.client\.[cm]?[jt]sx?$/.test(file)) {
    return null;
  }

  const globalWrite = findGlobalThisWrite(sourceFile);
  if (globalWrite) return `запись в ${globalWrite}`;

  for (const declaration of collectModuleDeclarations(sourceFile)) {
    if (!ts.isIdentifier(declaration.name)) continue;
    const declarationList = declaration.parent;
    const isConst = Boolean(declarationList.flags & ts.NodeFlags.Const);
    if (!isConst) return `модульная let/var ${declaration.name.text}`;
    if (!declaration.initializer) continue;

    const containerKind = mutableContainerKind(
      declaration.initializer,
      sourceFile,
      declaration.name.text,
    );
    if (containerKind) {
      return `модульный ${containerKind} ${declaration.name.text}`;
    }
  }

  return null;
}

export const RULES = [
  {
    name: "секреты не читаются в клиентских компонентах",
    files: "src/**/*.{ts,tsx}",
    check(source) {
      if (!/^\s*["']use client["']/m.test(source)) return null;

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
      const match = source.match(/\bdebugger\b|\bconsole\.log\s*\(/);
      return match ? match[0].replace(/\s*\($/, "") : null;
    },
    why: "отладочные вызовы уезжают в продакшен, шумят в консоли пользователя и иногда печатают в браузер данные, которых там быть не должно",
    fix: "удали вызов; если лог нужен постоянно — используй console.error или console.warn для настоящих ошибок",
  },
  {
    name: "доменные слои не импортируют mcp",
    files:
      "src/lib/{ranking,explain,packages}/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
    check(source, context) {
      if (!["ranking", "explain", "packages"].some((layer) => isInLayer(context.file, layer))) {
        return null;
      }
      return findForbiddenDependency(source, context, (file) =>
        isInLayer(file, "mcp"),
      );
    },
    why: "ranking, explain и packages должны работать с доменными DTO; зависимость от mcp связывает домен с форматом внешнего сервиса, в том числе через alias или промежуточный re-export",
    fix: "нормализуй ответ в слое mcp и передай доменный DTO через search/usecase; удали прямую или транзитивную зависимость доменного слоя от src/lib/mcp",
  },
  {
    name: "explain не импортирует реализацию ranking",
    files: "src/lib/explain/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
    check(source, context) {
      if (!isInLayer(context.file, "explain")) return null;
      return findForbiddenDependency(source, context, isRankingImplementation);
    },
    why: "объяснение должно строиться только из журнала реакций и признаков карточки; доступ к реализации ranking или её весам делает объяснение связанным с внутренностями модели",
    fix: "передай в explain готовые признаки и журнал через usecase; типы бери только из ranking/interface, реализацию ranking не импортируй напрямую или через промежуточный модуль",
  },
  {
    name: "сервер не хранит пользовательские данные",
    files: "src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
    check(source, context) {
      // Проверяемое подмножество правила 13: прямые записи в globalThis,
      // модульные let/var, Map/Set и пустые либо мутируемые массивы/объекты.
      // Проверка не доказывает отсутствие состояния: она не прослеживает alias
      // globalThis, class static, замыкания фабрик и состояние внутри зависимостей,
      // а также не умеет семантически отличать пользовательские данные. Поэтому
      // opaque const-соединение без накопителя разрешено, остальное остаётся ревью.
      return findCrossRequestState(source, context.file);
    },
    why: "модульное состояние и globalThis переживают HTTP-ответ в тёплом процессе и могут смешать результаты поиска или сессии разных пользователей",
    fix: "держи данные запроса в локальных переменных и возвращай состояние клиенту; переиспользуемое соединение без пользовательских данных оформляй как const без Map/Set/массива/объектного кэша",
  },
];

export function formatViolation(rule, file, detail) {
  return [
    `WHAT: ${file} — ${rule.name} (${detail})`,
    `WHY:  ${rule.why}`,
    `FIX:  ${rule.fix}`,
  ].join("\n");
}
