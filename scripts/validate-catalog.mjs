#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PROJECT_ROOT = process.cwd();
const CATALOG_FILE = path.resolve(PROJECT_ROOT, "data/destinations.json");
const REPORT_FILE = path.resolve(PROJECT_ROOT, "data/catalog-validation.json");
const WORK_FILE = `${REPORT_FILE}.partial`;
const MCP_ENDPOINT = "https://mcp.tutu.ru/mcp";
const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 6;
const DEFAULT_TIMEOUT_MS = 20_000;
const NIGHTS = 4;
const WINDOW_STRATEGY = "next-season-month-v1";
const NO_TRANSPORT_REASON = "transport_not_found_from_any_origin";

export function classifyToolResult(toolName, rawResult) {
  try {
    const result = unwrapJsonRpcResult(rawResult);
    if (!isRecord(result) || !Array.isArray(result.content)) {
      return "source_unavailable";
    }
    const content = result.content[0];
    if (!isRecord(content) || typeof content.text !== "string") {
      return "source_unavailable";
    }

    if (result.isError === true) {
      return isCouldNotResolve(content.text)
        ? "unresolved"
        : "source_unavailable";
    }

    const payload = JSON.parse(content.text);
    if (!isRecord(payload)) return "source_unavailable";

    if (toolName === "search_multitransport") {
      if (!Array.isArray(payload.variants)) return "source_unavailable";
      if (payload.variants.length > 0) return "offers_found";

      const meta = isRecord(payload.meta) ? payload.meta : {};
      const unavailable = Array.isArray(meta.unavailable)
        ? meta.unavailable
        : [];
      return unavailable.some(isUnresolvedUnavailable)
        ? "unresolved"
        : "no_offers_for_dates";
    }

    if (toolName === "search_hotels") {
      if (!Array.isArray(payload.hotels)) return "source_unavailable";
      return payload.hotels.length > 0
        ? "offers_found"
        : "no_offers_for_dates";
    }
  } catch {
    return "source_unavailable";
  }

  return "source_unavailable";
}

export async function validateCatalogDestination(
  destination,
  { invoke, origins, now = new Date(), referenceDate = now },
) {
  const window = seasonalWindow(destination.seasonMonths, referenceDate, NIGHTS);
  const hotelStatus = await probe(invoke, {
    name: "search_hotels",
    arguments: {
      city_name: destination.name,
      check_in: window.checkIn,
      check_out: window.checkOut,
      adults: 2,
      children_ages: [],
      page: 1,
      page_size: 1,
      view: "compact",
    },
  });

  const byOrigin = {};
  for (const origin of origins) {
    if (normalizeCity(origin) === normalizeCity(destination.name)) continue;
    byOrigin[origin] = await probe(invoke, {
      name: "search_multitransport",
      arguments: {
        origin,
        destination: destination.name,
        departure_date: window.checkIn,
        adults: 2,
        page: 1,
        page_size: 1,
        view: "compact",
      },
    });
  }

  const transportStatus = aggregateTransportStatus(Object.values(byOrigin));
  const reachableFrom = Object.entries(byOrigin)
    .filter(([, status]) => status === "offers_found")
    .map(([origin]) => origin);
  const status = reachableFrom.length > 0 ? "suitable" : "unsuitable";
  return {
    status,
    ...(status === "unsuitable" ? { reason: NO_TRANSPORT_REASON } : {}),
    checkedAt: now.toISOString(),
    window,
    transport: { status: transportStatus, byOrigin, reachableFrom },
    hotels: { status: hotelStatus },
  };
}

export function formatCatalogSummary(destinations) {
  const unsuitableNames = Object.entries(destinations)
    .filter(([, { status }]) => status === "unsuitable")
    .map(([name]) => name)
    .sort();
  const unsuitableSummary = unsuitableNames.length > 0
    ? `${unsuitableNames.length} (${unsuitableNames.join(", ")})`
    : "0";
  return `непригодных ${unsuitableSummary}`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const catalogText = readFileSync(CATALOG_FILE, "utf8");
  const catalog = JSON.parse(catalogText);
  assertCatalog(catalog);

  const origins = Object.keys(catalog[0].reachability);
  const destinationNames = catalog.map(({ name }) => name);
  const catalogHash = createHash("sha256").update(catalogText).digest("hex");
  const workReport = options.force ? null : readReport(WORK_FILE);
  const stableReport = options.force ? null : readReport(REPORT_FILE);
  let report = canResume(workReport, catalogHash, origins)
    ? workReport
    : canResume(stableReport, catalogHash, origins)
      ? stableReport
      : null;

  if (report) {
    if (report.run.status === "complete") {
      if (report === workReport) {
        if (
          commitCatalogValidation(report, destinationNames, {
            reportFile: REPORT_FILE,
            workFile: WORK_FILE,
          })
        ) {
          console.log(
            `Завершённый промежуточный отчёт сохранён: ${path.relative(PROJECT_ROOT, REPORT_FILE)}.`,
          );
          return;
        }
        report = null;
      } else {
        console.log(
          `Каталог уже проверен ${report.run.completedAt ?? report.run.startedAt}. ` +
            "Для нового полного прогона передайте --force.",
        );
        return;
      }
    }
  }

  if (!report) {
    report = createReport(catalogHash, origins);
    persistCatalogValidation(report);
  }

  report.run.status = "in_progress";
  report.run.completedAt = null;
  const pending = catalog.filter((destination) => {
    const existing = report.destinations[destination.name];
    return !existing || existing.status === "inconclusive";
  });
  console.log(
    `Проверка каталога: ${pending.length} из ${catalog.length}, ` +
      `параллельность ${options.concurrency}.`,
  );

  const controller = new AbortController();
  const abort = () => controller.abort(new Error("Catalog validation aborted"));
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);

  const invoke = createMcpInvoker({
    signal: controller.signal,
    timeoutMs: options.timeoutMs,
  });
  const referenceDate = new Date(
    `${report.run.matrix.referenceDate}T12:00:00.000Z`,
  );

  try {
    await mapWithConcurrency(pending, options.concurrency, async (destination) => {
      if (controller.signal.aborted) throw controller.signal.reason;
      const result = await validateCatalogDestination(destination, {
        invoke,
        origins,
        now: new Date(),
        referenceDate,
      });
      report.destinations[destination.name] = result;
      persistCatalogValidation(report);
      console.log(`${destination.name}: ${result.status}`);
    });
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }

  report.run.status = "complete";
  report.run.completedAt = new Date().toISOString();
  persistCatalogValidation(report);

  if (!commitCatalogValidation(report, destinationNames)) {
    report.run.status = "incomplete";
    persistCatalogValidation(report);
    console.error(
      `Получен неполный отчёт (${Object.keys(report.destinations).length} из ` +
        `${destinationNames.length}). Рабочий файл НЕ перезаписан.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Готово: ${formatCatalogSummary(report.destinations)}. ` +
      `Отчёт: ${path.relative(PROJECT_ROOT, REPORT_FILE)}`,
  );
}

function createMcpInvoker({ signal, timeoutMs }) {
  return async ({ name, arguments: args }) => {
    const client = new Client({
      name: "tutu-swipe-catalog-validator",
      version: "0.1.0",
    });
    const transport = new StreamableHTTPClientTransport(new URL(MCP_ENDPOINT), {
      requestInit: {
        headers: { Accept: "application/json, text/event-stream" },
      },
    });
    const requestOptions = {
      signal,
      timeout: timeoutMs,
      maxTotalTimeout: timeoutMs,
    };

    try {
      await client.connect(transport, requestOptions);
      return await client.callTool(
        { name, arguments: args ?? {} },
        undefined,
        requestOptions,
      );
    } finally {
      await client.close().catch(() => undefined);
    }
  };
}

async function probe(invoke, request) {
  try {
    const result = await invoke(request);
    return classifyToolResult(request.name, result);
  } catch {
    return "source_unavailable";
  }
}

function aggregateTransportStatus(statuses) {
  if (statuses.includes("offers_found")) return "offers_found";
  if (statuses.includes("no_offers_for_dates")) return "no_offers_for_dates";
  if (statuses.length > 0 && statuses.every((status) => status === "unresolved")) {
    return "unresolved";
  }
  return "source_unavailable";
}

function seasonalWindow(seasonMonths, referenceDate, nights) {
  const earliest = new Date(referenceDate);
  earliest.setUTCHours(0, 0, 0, 0);
  earliest.setUTCDate(earliest.getUTCDate() + 30);

  for (let offset = 0; offset <= 18; offset += 1) {
    const year = earliest.getUTCFullYear() +
      Math.floor((earliest.getUTCMonth() + offset) / 12);
    const monthIndex = (earliest.getUTCMonth() + offset) % 12;
    if (!seasonMonths.includes(monthIndex + 1)) continue;

    const checkIn = new Date(Date.UTC(year, monthIndex, 15));
    if (checkIn < earliest) continue;
    const checkOut = new Date(checkIn);
    checkOut.setUTCDate(checkOut.getUTCDate() + nights);
    return {
      checkIn: formatDate(checkIn),
      checkOut: formatDate(checkOut),
    };
  }

  throw new Error(`Не найдено сезонное окно для месяцев: ${seasonMonths}`);
}

function readReport(file) {
  try {
    const report = JSON.parse(readFileSync(file, "utf8"));
    return isReport(report) ? report : null;
  } catch {
    return null;
  }
}

function createReport(catalogHash, origins) {
  const startedAt = new Date().toISOString();
  return {
    schemaVersion: 2,
    run: {
      status: "in_progress",
      startedAt,
      completedAt: null,
      catalogHash,
      matrix: {
        origins,
        windowStrategy: WINDOW_STRATEGY,
        nights: NIGHTS,
        referenceDate: startedAt.slice(0, 10),
      },
    },
    destinations: {},
  };
}

function canResume(report, catalogHash, origins) {
  return Boolean(
    isReport(report) &&
      report.run &&
      report.run.catalogHash === catalogHash &&
      report.run.matrix?.windowStrategy === WINDOW_STRATEGY &&
      report.run.matrix.nights === NIGHTS &&
      report.run.matrix.referenceDate &&
      Array.isArray(report.run.matrix.origins) &&
      arraysEqual(report.run.matrix.origins, origins),
  );
}

function isReport(value) {
  return (
    isRecord(value) &&
    value.schemaVersion === 2 &&
    (value.run === null || isRecord(value.run)) &&
    isRecord(value.destinations)
  );
}

export function persistCatalogValidation(report, workFile = WORK_FILE) {
  const temporaryFile = `${workFile}.tmp`;
  writeFileSync(temporaryFile, `${JSON.stringify(report, null, 2)}\n`);
  renameSync(temporaryFile, workFile);
}

export function commitCatalogValidation(
  report,
  expectedDestinations,
  { reportFile = REPORT_FILE, workFile = WORK_FILE } = {},
) {
  const actualDestinations = Object.keys(report.destinations ?? {});
  const expected = new Set(expectedDestinations);
  const complete =
    report.run?.status === "complete" &&
    expected.size > 0 &&
    actualDestinations.length === expected.size &&
    actualDestinations.every((destination) => expected.has(destination));
  if (!complete) return false;

  renameSync(workFile, reportFile);
  return true;
}

async function mapWithConcurrency(items, concurrency, worker) {
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, runWorker),
  );
}

function parseArguments(argumentsList) {
  let concurrency = DEFAULT_CONCURRENCY;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let force = false;

  for (const argument of argumentsList) {
    if (argument === "--force") {
      force = true;
      continue;
    }
    if (argument.startsWith("--concurrency=")) {
      concurrency = Number(argument.slice("--concurrency=".length));
      continue;
    }
    if (argument.startsWith("--timeout-ms=")) {
      timeoutMs = Number(argument.slice("--timeout-ms=".length));
      continue;
    }
    throw new Error(`Неизвестный аргумент: ${argument}`);
  }

  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
    throw new Error(`--concurrency должен быть целым числом от 1 до ${MAX_CONCURRENCY}`);
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) {
    throw new Error("--timeout-ms должен быть не меньше 1000");
  }
  return { concurrency, timeoutMs, force };
}

function assertCatalog(value) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every(
      (destination) =>
        isRecord(destination) &&
        typeof destination.name === "string" &&
        Array.isArray(destination.seasonMonths) &&
        destination.seasonMonths.every(
          (month) => Number.isInteger(month) && month >= 1 && month <= 12,
        ) &&
        isRecord(destination.reachability),
    )
  ) {
    throw new Error("data/destinations.json имеет неверную структуру");
  }
}

function isUnresolvedUnavailable(value) {
  if (!isRecord(value)) return false;
  const reason =
    typeof value.reason === "string"
      ? value.reason.trim().toLowerCase().replace(/[\s-]+/g, "_")
      : "";
  return (
    reason === "no_route" ||
    reason === "could_not_resolve" ||
    (typeof value.detail === "string" && isCouldNotResolve(value.detail))
  );
}

function isCouldNotResolve(text) {
  return /\bcould\s+not\s+resolve\b/i.test(text);
}

function unwrapJsonRpcResult(value) {
  return isRecord(value) && isRecord(value.result) ? value.result : value;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCity(city) {
  return city.normalize("NFKC").trim().toLowerCase().replaceAll("ё", "е");
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
