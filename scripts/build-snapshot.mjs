#!/usr/bin/env node

import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PROJECT_ROOT = process.cwd();
const VALIDATION_FILE = path.resolve(
  PROJECT_ROOT,
  "data/catalog-validation.json",
);
const SNAPSHOT_DIRECTORY = path.resolve(PROJECT_ROOT, "data/snapshot");
const SNAPSHOT_FILE = path.resolve(SNAPSHOT_DIRECTORY, "catalog.json");
const WORK_FILE = `${SNAPSHOT_FILE}.partial`;
const MCP_ENDPOINT = "https://mcp.tutu.ru/mcp";
const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 6;
const DEFAULT_TIMEOUT_MS = 20_000;
const EXPECTED_ORIGIN_COUNT = 6;
const SNAPSHOT_ADULTS = 2;
const TRANSPORT_PAGE_SIZE = 30;
/**
 * Сколько вариантов жилья сохранять на направление.
 *
 * Был один, и лента показывала «Туапсе / Санаторий Арго / поезд» и
 * «Туапсе / Санаторий Арго / автобус» — один и тот же отель дважды, менялась
 * только дорога. Владелец справедливо спросил, почему не может быть тот же
 * город, но другое жильё. Теперь берём три.
 */
const HOTEL_PAGE_SIZE = 3;

export function projectSnapshotEntry({
  origin,
  destination,
  builtAt,
  adults,
  transportPayload,
  hotelPayload,
}) {
  const transportVariants = requiredArray(
    requiredRecord(transportPayload, "transport payload").variants,
    "transport variants",
  );
  const hotels = requiredArray(
    requiredRecord(hotelPayload, "hotel payload").hotels,
    "hotels",
  );
  const compactTransport = projectTransport(transportVariants[0]);
  // По одной записи на отель: формат остаётся прежним, а направление получает
  // несколько вариантов жилья вместо одного повторяющегося.
  const compactHotels = hotels
    .map(projectHotel)
    .filter((hotel) => hotel !== null);
  const compactHotel = compactHotels[0];
  if (!compactTransport || !compactHotel) return null;
  if (
    compactTransport.price.currency !==
    compactHotel.best_offer.price.currency
  ) {
    return null;
  }

  const alternative = fastestOfOtherKind([
    compactTransport,
    ...transportVariants.slice(1).map(projectTransport).filter(Boolean),
  ]);
  const transports = [compactTransport];
  if (
    alternative &&
    alternative.price.currency === compactHotel.best_offer.price.currency
  ) {
    transports.push(alternative);
  }
  const stay = projectStay(
    requiredRecord(hotelPayload, "hotel payload").stay,
  );
  const base = {
    origin: requiredString(origin, "origin"),
    destination: requiredString(destination, "destination"),
    builtAt: requiredIsoDate(builtAt, "builtAt"),
    adults: requiredPositiveInteger(adults, "adults"),
    transports,
    stay,
  };
  return compactHotels
    .filter(
      (hotel) =>
        hotel.best_offer.price.currency === compactTransport.price.currency,
    )
    .map((hotel) => ({ ...base, hotel }));
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const validation = JSON.parse(readFileSync(VALIDATION_FILE, "utf8"));
  const { origins, destinations } = readBuildMatrix(validation);
  const startedAt = new Date().toISOString();
  const output = {
    schemaVersion: 2,
    run: {
      status: "in_progress",
      startedAt,
      completedAt: null,
      matrix: {
        origins,
        windowStrategy: validation.run.matrix.windowStrategy,
        referenceDate: validation.run.matrix.referenceDate,
      },
      failures: [],
    },
    entries: [],
  };

  mkdirSync(SNAPSHOT_DIRECTORY, { recursive: true });
  persistSnapshot(output);
  console.log(
    `Снапшот: ${destinations.length} направлений, ` +
      `${origins.length} городов отправления, ` +
      `параллельность ${options.concurrency}.`,
  );

  const controller = new AbortController();
  const abort = () => controller.abort(new Error("Snapshot build aborted"));
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  const invoke = createMcpInvoker({
    signal: controller.signal,
    timeoutMs: options.timeoutMs,
  });

  try {
    await mapWithConcurrency(
      destinations,
      options.concurrency,
      async ({ destination, validation: destinationValidation }) => {
        if (controller.signal.aborted) throw controller.signal.reason;
        const window = destinationValidation.window;
        let hotelPayload;
        try {
          hotelPayload = await invokePayload(invoke, {
            name: "search_hotels",
            arguments: {
              city_name: destination,
              check_in: window.checkIn,
              check_out: window.checkOut,
              adults: SNAPSHOT_ADULTS,
              children_ages: [],
              page: 1,
              page_size: HOTEL_PAGE_SIZE,
              view: "compact",
            },
          });
        } catch (error) {
          recordFailure(output, destination, null, error);
          persistSnapshot(output);
          return;
        }

        for (const origin of destinationValidation.transport.reachableFrom) {
          if (controller.signal.aborted) throw controller.signal.reason;
          try {
            const transportPayload = await invokePayload(invoke, {
              name: "search_multitransport",
              arguments: {
                origin,
                destination,
                departure_date: window.checkIn,
                adults: SNAPSHOT_ADULTS,
                optimize_for: "price",
                page: 1,
                page_size: TRANSPORT_PAGE_SIZE,
                view: "compact",
              },
            });
            const entries = projectSnapshotEntry({
              origin,
              destination,
              builtAt: new Date().toISOString(),
              adults: SNAPSHOT_ADULTS,
              transportPayload,
              hotelPayload,
            });
            if (entries && entries.length > 0) output.entries.push(...entries);
            else {
              recordFailure(
                output,
                destination,
                origin,
                new Error("card cannot be built from compact offers"),
              );
            }
          } catch (error) {
            recordFailure(output, destination, origin, error);
          }
        }

        sortEntries(output.entries);
        persistSnapshot(output);
        console.log(
          `${destination}: ${countSnapshotCards(
            output.entries.filter(
              (entry) => entry.destination === destination,
            ),
          )} карточек`,
        );
      },
    );
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }

  output.run.status = output.run.failures.length === 0 ? "complete" : "incomplete";
  output.run.completedAt = new Date().toISOString();
  sortEntries(output.entries);

  // Пустой результат почти всегда значит, что лежит источник, а не что
  // направлений не стало. 11 августа MCP отдавал HTTP 503 страницей HTML, и
  // прогон затёр бы рабочий снапшот нулём карточек. Держим прежний файл.
  if (output.entries.length === 0) {
    discardWorkFile();
    console.error(
      `Ни одной карточки собрать не удалось (${output.run.failures.length} ошибок). ` +
        `Снапшот НЕ перезаписан — прежний файл сохранён.`,
    );
    process.exitCode = 1;
    return;
  }

  persistSnapshot(output);
  commitSnapshot();
  console.log(
    `Готово: ${countSnapshotCards(output.entries)} карточек, ` +
      `${output.run.failures.length} ошибок. Файл: ` +
      path.relative(PROJECT_ROOT, SNAPSHOT_FILE),
  );
  if (output.run.failures.length > 0) process.exitCode = 1;
}

function readBuildMatrix(validation) {
  if (
    !isRecord(validation) ||
    validation.schemaVersion !== 2 ||
    !isRecord(validation.run) ||
    validation.run.status !== "complete" ||
    !isRecord(validation.run.matrix) ||
    !Array.isArray(validation.run.matrix.origins) ||
    validation.run.matrix.origins.length !== EXPECTED_ORIGIN_COUNT ||
    !isRecord(validation.destinations)
  ) {
    throw new Error(
      "data/catalog-validation.json не содержит завершённую матрицу из 6 городов",
    );
  }

  const origins = validation.run.matrix.origins.map((origin, index) =>
    requiredString(origin, `run.matrix.origins[${index}]`),
  );
  const destinations = Object.entries(validation.destinations)
    .filter(([, value]) => isRecord(value) && value.status === "suitable")
    .map(([destination, value]) => {
      const result = requiredRecord(value, destination);
      const window = requiredRecord(result.window, `${destination}.window`);
      const transport = requiredRecord(
        result.transport,
        `${destination}.transport`,
      );
      const reachableFrom = requiredArray(
        transport.reachableFrom,
        `${destination}.transport.reachableFrom`,
      ).map((origin, index) =>
        requiredString(origin, `${destination}.reachableFrom[${index}]`),
      );
      return {
        destination,
        validation: {
          window: {
            checkIn: requiredString(window.checkIn, `${destination}.checkIn`),
            checkOut: requiredString(window.checkOut, `${destination}.checkOut`),
          },
          transport: {
            reachableFrom: reachableFrom.filter((origin) =>
              origins.includes(origin),
            ),
          },
        },
      };
    });

  return { origins, destinations };
}

function createMcpInvoker({ signal, timeoutMs }) {
  return async ({ name, arguments: args }) => {
    const client = new Client({
      name: "tutu-swipe-snapshot-builder",
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

async function invokePayload(invoke, request) {
  const rawResult = await invoke(request);
  const result =
    isRecord(rawResult) && isRecord(rawResult.result)
      ? rawResult.result
      : rawResult;
  const record = requiredRecord(result, `${request.name} result`);
  if (record.isError === true || !Array.isArray(record.content)) {
    throw new Error(`${request.name} returned an error`);
  }
  const content = requiredRecord(record.content[0], `${request.name} content`);
  if (typeof content.text !== "string") {
    throw new Error(`${request.name} returned no text payload`);
  }
  return JSON.parse(content.text);
}

function projectTransport(value) {
  if (!isRecord(value)) return null;
  const searchResultsUrl = optionalString(value.search_results_url);
  if (!searchResultsUrl) return null;
  try {
    return {
      offer_id: requiredString(value.offer_id, "transport.offer_id"),
      transport: requiredString(value.transport, "transport.transport"),
      price: projectMoney(value.price, "transport.price"),
      duration_min: requiredNumber(value.duration_min, "transport.duration_min"),
      carriers: optionalStringArray(value.carriers),
      departure_at: requiredString(value.departure_at, "transport.departure_at"),
      arrival_at: requiredString(value.arrival_at, "transport.arrival_at"),
      search_results_url: searchResultsUrl,
      legs: optionalArray(value.legs).map(projectLeg),
    };
  } catch {
    return null;
  }
}

function fastestOfOtherKind(variants) {
  const cheapest = variants[0];
  if (!cheapest) return undefined;
  let best;
  for (const variant of variants) {
    if (variant.transport === cheapest.transport) continue;
    if (!best || variant.duration_min < best.duration_min) best = variant;
  }
  return best;
}

function projectLeg(value, index) {
  const leg = requiredRecord(value, `transport.legs[${index}]`);
  return {
    ...(optionalString(leg.label) ? { label: optionalString(leg.label) } : {}),
    from: requiredString(leg.from, `transport.legs[${index}].from`),
    to: requiredString(leg.to, `transport.legs[${index}].to`),
    departure_at: requiredString(
      leg.departure_at,
      `transport.legs[${index}].departure_at`,
    ),
    arrival_at: requiredString(
      leg.arrival_at,
      `transport.legs[${index}].arrival_at`,
    ),
    duration_min: requiredNumber(
      leg.duration_min,
      `transport.legs[${index}].duration_min`,
    ),
    segments: optionalArray(leg.segments).map(projectSegment),
  };
}

function projectSegment(value, index) {
  const segment = requiredRecord(value, `transport.segment[${index}]`);
  return {
    from: requiredString(segment.from, `transport.segment[${index}].from`),
    to: requiredString(segment.to, `transport.segment[${index}].to`),
    departure_at: requiredString(
      segment.departure_at,
      `transport.segment[${index}].departure_at`,
    ),
    arrival_at: requiredString(
      segment.arrival_at,
      `transport.segment[${index}].arrival_at`,
    ),
    duration_min: requiredNumber(
      segment.duration_min,
      `transport.segment[${index}].duration_min`,
    ),
    ...(optionalString(segment.carrier)
      ? { carrier: optionalString(segment.carrier) }
      : {}),
    ...(optionalString(segment.voyage_no)
      ? { voyage_no: optionalString(segment.voyage_no) }
      : {}),
  };
}

function projectHotel(value) {
  if (!isRecord(value) || !isRecord(value.best_offer)) return null;
  if (value.best_offer.price_basis !== "stay_total") return null;
  try {
    const bestOffer = value.best_offer;
    return {
      hotel_id: requiredString(value.hotel_id, "hotel.hotel_id"),
      name: requiredString(value.name, "hotel.name"),
      ...(optionalNumber(value.stars) !== undefined
        ? { stars: optionalNumber(value.stars) }
        : {}),
      ...(optionalNumber(value.rating) !== undefined
        ? { rating: optionalNumber(value.rating) }
        : {}),
      ...(optionalNumber(value.review_count) !== undefined
        ? { review_count: optionalNumber(value.review_count) }
        : {}),
      ...(optionalString(value.address)
        ? { address: optionalString(value.address) }
        : {}),
      photos: optionalStringArray(value.photos).slice(0, 3),
      best_offer: {
        ...(optionalString(bestOffer.room_name)
          ? { room_name: optionalString(bestOffer.room_name) }
          : {}),
        price: projectMoney(bestOffer.price, "hotel.best_offer.price"),
        price_basis: "stay_total",
        ...(typeof bestOffer.breakfast_included === "boolean"
          ? { breakfast_included: bestOffer.breakfast_included }
          : {}),
        ...(typeof bestOffer.free_cancellation === "boolean"
          ? { free_cancellation: bestOffer.free_cancellation }
          : {}),
      },
    };
  } catch {
    return null;
  }
}

function projectStay(value) {
  const stay = requiredRecord(value, "stay");
  return {
    check_in: requiredString(stay.check_in, "stay.check_in"),
    check_out: requiredString(stay.check_out, "stay.check_out"),
    nights: requiredNumber(stay.nights, "stay.nights"),
  };
}

function projectMoney(value, label) {
  const money = requiredRecord(value, label);
  return {
    amount: requiredNumber(money.amount, `${label}.amount`),
    currency: requiredString(money.currency, `${label}.currency`),
  };
}

function recordFailure(output, destination, origin, error) {
  output.run.failures.push({
    destination,
    ...(origin ? { origin } : {}),
    message: error instanceof Error ? error.message : String(error),
  });
}

/**
 * Промежуточный прогресс идёт в отдельный файл, а не в рабочий снапшот.
 * Раньше запись велась прямо в catalog.json — включая пустую заготовку в самом
 * начале, — поэтому упавший прогон оставлял ноль карточек вместо прежних данных.
 */
function persistSnapshot(output) {
  const temporaryFile = `${WORK_FILE}.tmp`;
  writeFileSync(temporaryFile, `${JSON.stringify(output)}\n`);
  renameSync(temporaryFile, WORK_FILE);
}

/** Заменяет рабочий снапшот собранным. Вызывается только при непустом результате. */
function commitSnapshot() {
  renameSync(WORK_FILE, SNAPSHOT_FILE);
}

function discardWorkFile() {
  try {
    unlinkSync(WORK_FILE);
  } catch {
    // Файла может не быть, если прогон упал до первой записи.
  }
}

function sortEntries(entries) {
  entries.sort(
    (left, right) =>
      left.origin.localeCompare(right.origin, "ru") ||
      left.destination.localeCompare(right.destination, "ru"),
  );
}

function countSnapshotCards(entries) {
  return entries.reduce((count, entry) => count + entry.transports.length, 0);
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
  for (const argument of argumentsList) {
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
  return { concurrency, timeoutMs };
}

function requiredRecord(value, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function optionalArray(value) {
  if (value === undefined || value === null) return [];
  return requiredArray(value, "optional value");
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function optionalString(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalStringArray(value) {
  return optionalArray(value).filter((item) => typeof item === "string");
}

function requiredNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function requiredPositiveInteger(value, label) {
  const number = requiredNumber(value, label);
  if (!Number.isInteger(number) || number < 1) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return number;
}

function optionalNumber(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function requiredIsoDate(value, label) {
  const stringValue = requiredString(value, label);
  if (!Number.isFinite(Date.parse(stringValue))) {
    throw new TypeError(`${label} must be an ISO date`);
  }
  return stringValue;
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
