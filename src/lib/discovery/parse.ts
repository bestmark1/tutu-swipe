import { MONTHS, ORIGIN_CITIES, VIBE_SYNONYMS } from "./dictionaries";
import {
  unavailableDiscoveryFallback,
  type DateWindow,
  type DiscoveryBlockingField,
  type DiscoveryFallbackParser,
  type DiscoveryParseResult,
  type DiscoveryQuery,
  type DiscoveryRequiredField,
  type PartialDiscoveryQuery,
  type TravellerComposition,
  type TripBudget,
  type VibeTag,
} from "./schema";

const DEFAULT_START_DAY = 10;
const DEFAULT_NIGHTS = 4;

export interface ParseTravelQueryOptions {
  today: Date;
  fallback?: DiscoveryFallbackParser;
}

export async function parseTravelQuery(
  input: string,
  options: ParseTravelQueryOptions,
): Promise<DiscoveryParseResult> {
  assertValidToday(options.today);
  const text = normalizeText(input);
  const travellerMatch = parseTravellers(text);
  const parsed: PartialDiscoveryQuery = {
    origin: parseOrigin(text),
    travellers: travellerMatch.value,
    dateWindow: parseDateWindow(text, options.today),
    budget: parseBudget(text),
    vibeTags: parseVibeTags(text),
  };
  removeMissingValues(parsed);

  const missingFields = findMissingFields(parsed);
  if (missingFields.length === 0) {
    return success(parsed, "rules");
  }

  const blockingFields = findBlockingFields(parsed, travellerMatch);
  const fallback = options.fallback ?? unavailableDiscoveryFallback;
  const fallbackParsed = await fallback.parse({
    input,
    today: formatDate(
      options.today.getUTCFullYear(),
      options.today.getUTCMonth() + 1,
      options.today.getUTCDate(),
    ),
    parsed: copyPartialQuery(parsed),
    missingFields: [...missingFields],
    blockingFields: [...blockingFields],
  });
  const combined = mergeRuleAndFallbackResults(parsed, fallbackParsed);
  const combinedMissingFields = findMissingFields(combined);

  if (combinedMissingFields.length === 0) {
    return success(combined, "rules+fallback");
  }

  const recognizedNothing = recognizedFieldCount(parsed) === 0;
  return {
    status: "rejected",
    source: "rules+fallback",
    code: recognizedNothing ? "unrecognized" : "incomplete",
    message: recognizedNothing
      ? "Не удалось понять запрос о поездке."
      : "Не удалось собрать все параметры поездки.",
    hint:
      "Укажите город отправления, состав путешественников, даты, общий бюджет и желаемый формат отдыха.",
    missingFields: combinedMissingFields,
    blockingFields: unresolvedBlockingFields(blockingFields, combined),
  };
}

function parseOrigin(text: string): string | undefined {
  const aliases = ORIGIN_CITIES.flatMap((city) =>
    city.aliases.map((alias) => ({ alias: normalizeText(alias), city })),
  ).sort((left, right) => right.alias.length - left.alias.length);

  for (const { alias, city } of aliases) {
    const pattern = new RegExp(
      `(?:^|[\\s,;])из\\s+(?:города\\s+)?${escapeRegExp(alias)}(?=$|[\\s,.;!?])`,
      "u",
    );
    if (pattern.test(text)) {
      return city.name;
    }
  }

  return undefined;
}

interface TravellerMatch {
  value?: TravellerComposition;
  childrenMentionedWithoutAges: boolean;
}

function parseTravellers(text: string): TravellerMatch {
  const childrenMentioned = /(?:дет(?:и|ей|ьми)|ребен(?:ок|ком|ка))/u.test(
    text,
  );
  const childrenAges = childrenMentioned ? parseChildAges(text) : [];
  const childrenMentionedWithoutAges =
    childrenMentioned && childrenAges.length === 0;

  let adults: number | undefined;
  if (/(?:вдвоем|на двоих)/u.test(text)) {
    adults = 2;
  } else {
    const numericAdults = text.match(/(\d{1,2})\s*взросл(?:ых|ого|ый)/u);
    const wordAdults = text.match(
      /(?:один|одна)\s+взросл|двое\s+взросл|трое\s+взросл/u,
    );
    if (numericAdults) {
      adults = Number(numericAdults[1]);
    } else if (wordAdults?.[0].startsWith("двое")) {
      adults = 2;
    } else if (wordAdults?.[0].startsWith("трое")) {
      adults = 3;
    } else if (wordAdults) {
      adults = 1;
    }
  }

  if (!adults || childrenMentionedWithoutAges) {
    return { childrenMentionedWithoutAges };
  }

  return {
    value: { adults, childrenAges },
    childrenMentionedWithoutAges,
  };
}

function parseChildAges(text: string): number[] {
  const ages = new Set<number>();
  const pairedAges = text.match(
    /(?:дет(?:и|ей|ьми)|ребен(?:ок|ком|ка))\s+(\d{1,2})\s*(?:и|,)\s*(\d{1,2})\s*(?:лет|года?)/u,
  );
  if (pairedAges) {
    ages.add(Number(pairedAges[1]));
    ages.add(Number(pairedAges[2]));
  }

  for (const match of text.matchAll(/(\d{1,2})\s*(?:лет|года?)/gu)) {
    ages.add(Number(match[1]));
  }

  return [...ages].filter(isChildAge).sort((left, right) => left - right);
}

function isChildAge(age: number): boolean {
  return Number.isInteger(age) && age >= 0 && age <= 17;
}

function parseDateWindow(text: string, today: Date): DateWindow | undefined {
  const nights = parseNights(text) ?? DEFAULT_NIGHTS;
  const isoDate = text.match(/(?:^|\s)(\d{4})-(\d{2})-(\d{2})(?=$|[\s,.;!?])/u);
  if (isoDate) {
    const year = Number(isoDate[1]);
    const month = Number(isoDate[2]);
    const day = Number(isoDate[3]);
    if (isCalendarDate(year, month, day)) {
      return { startDate: formatDate(year, month, day), nights };
    }
  }

  for (const monthEntry of MONTHS) {
    for (const alias of monthEntry.aliases) {
      const aliasPattern = escapeRegExp(alias);
      const specificDate = text.match(
        new RegExp(
          `(?:^|\\s)(\\d{1,2})\\s+${aliasPattern}(?:\\s+(\\d{4}))?(?=$|[\\s,.;!?])`,
          "u",
        ),
      );
      if (specificDate) {
        return relativeDateWindow(
          monthEntry.month,
          Number(specificDate[1]),
          specificDate[2] ? Number(specificDate[2]) : undefined,
          nights,
          today,
        );
      }
      if (new RegExp(`(?:^|[\\s,])${aliasPattern}(?=$|[\\s,.;!?])`, "u").test(text)) {
        return relativeDateWindow(
          monthEntry.month,
          DEFAULT_START_DAY,
          undefined,
          nights,
          today,
        );
      }
    }
  }

  return undefined;
}

function relativeDateWindow(
  month: number,
  day: number,
  explicitYear: number | undefined,
  nights: number,
  today: Date,
): DateWindow | undefined {
  // `today` is a UTC calendar day, so local time zones cannot affect rollover.
  const todayStamp = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );

  if (explicitYear !== undefined) {
    if (
      !isCalendarDate(explicitYear, month, day) ||
      Date.UTC(explicitYear, month - 1, day) < todayStamp
    ) {
      return undefined;
    }

    return { startDate: formatDate(explicitYear, month, day), nights };
  }

  const currentYear = today.getUTCFullYear();
  for (let offset = 0; offset <= 8; offset += 1) {
    const year = currentYear + offset;
    if (
      isCalendarDate(year, month, day) &&
      Date.UTC(year, month - 1, day) >= todayStamp
    ) {
      return { startDate: formatDate(year, month, day), nights };
    }
  }

  return undefined;
}

function parseNights(text: string): number | undefined {
  const numeric = text.match(/на\s+(\d{1,2})\s*(?:ноч(?:ь|и|ей)|дн(?:я|ей))/u);
  if (numeric) {
    const nights = Number(numeric[1]);
    return nights > 0 ? nights : undefined;
  }
  if (/на\s+недел(?:ю|и)/u.test(text)) {
    return 7;
  }
  if (/на\s+выходные/u.test(text)) {
    return 2;
  }
  return undefined;
}

function parseBudget(text: string): TripBudget | undefined {
  const thousands = text.match(
    /(\d+(?:[.,]\d+)?)\s*(?:к|k|тыс(?:\.|яч(?:а|и|у)?|(?=$|[\s,;!?])))(?!\s*(?:год(?:а)?|лет|ноч(?:ь|и|ей)|д(?:ень|ня|ней))(?=$|[\s,.;!?]))(?=$|[\s,.;!?])/u,
  );
  if (thousands) {
    return totalBudget(Math.round(Number(thousands[1].replace(",", ".")) * 1_000));
  }

  const rubles = text.match(
    /(\d(?:[\d\s]*\d)?)\s*руб(?:ль|ля|лей|\.)?(?=$|[\s,.;!?])/u,
  );
  if (rubles) {
    return totalBudget(Number(rubles[1].replace(/\s/gu, "")));
  }

  const prefixed = text.match(
    /(?:до|бюджет(?:ом)?\s+до)\s+(\d{4,})(?!\d|-\d)(?!\s*(?:год(?:а)?|лет|ноч(?:ь|и|ей)|д(?:ень|ня|ней))(?=$|[\s,.;!?]))/u,
  );
  return prefixed ? totalBudget(Number(prefixed[1])) : undefined;
}

function totalBudget(amount: number): TripBudget | undefined {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return undefined;
  }
  return { amount, currency: "RUB", scope: "group_trip_total" };
}

function parseVibeTags(text: string): VibeTag[] {
  return VIBE_SYNONYMS.filter(({ phrases }) =>
    phrases.some((phrase) => text.includes(normalizeText(phrase))),
  ).map(({ tag }) => tag);
}

function mergeRuleAndFallbackResults(
  rules: PartialDiscoveryQuery,
  fallback: PartialDiscoveryQuery | null | undefined,
): PartialDiscoveryQuery {
  if (!fallback) {
    return rules;
  }
  return {
    origin: rules.origin ?? fallback.origin,
    travellers: rules.travellers ?? fallback.travellers,
    dateWindow: rules.dateWindow ?? fallback.dateWindow,
    budget: rules.budget ?? fallback.budget,
    vibeTags:
      rules.vibeTags && rules.vibeTags.length > 0
        ? rules.vibeTags
        : fallback.vibeTags,
  };
}

function copyPartialQuery(parsed: PartialDiscoveryQuery): PartialDiscoveryQuery {
  return {
    ...parsed,
    travellers: parsed.travellers
      ? {
          ...parsed.travellers,
          childrenAges: [...parsed.travellers.childrenAges],
        }
      : undefined,
    dateWindow: parsed.dateWindow ? { ...parsed.dateWindow } : undefined,
    budget: parsed.budget ? { ...parsed.budget } : undefined,
    vibeTags: parsed.vibeTags ? [...parsed.vibeTags] : undefined,
  };
}

function findMissingFields(
  parsed: PartialDiscoveryQuery,
): DiscoveryRequiredField[] {
  const missing: DiscoveryRequiredField[] = [];
  if (!parsed.origin) missing.push("origin");
  if (!parsed.travellers) missing.push("travellers");
  if (!parsed.dateWindow) missing.push("dateWindow");
  if (!parsed.budget) missing.push("budget");
  if (!parsed.vibeTags || parsed.vibeTags.length === 0) missing.push("vibeTags");
  return missing;
}

function findBlockingFields(
  parsed: PartialDiscoveryQuery,
  travellerMatch: TravellerMatch,
): DiscoveryBlockingField[] {
  const blocking: DiscoveryBlockingField[] = [];
  if (!parsed.origin) blocking.push("origin");
  if (travellerMatch.childrenMentionedWithoutAges) {
    blocking.push("childrenAges");
  }
  return blocking;
}

function unresolvedBlockingFields(
  blockingFields: DiscoveryBlockingField[],
  parsed: PartialDiscoveryQuery,
): DiscoveryBlockingField[] {
  return blockingFields.filter((field) => {
    if (field === "origin") return !parsed.origin;
    return !parsed.travellers || parsed.travellers.childrenAges.length === 0;
  });
}

function success(
  parsed: PartialDiscoveryQuery,
  source: "rules" | "rules+fallback",
): DiscoveryParseResult {
  return {
    status: "success",
    source,
    query: parsed as DiscoveryQuery,
  };
}

function removeMissingValues(parsed: PartialDiscoveryQuery): void {
  for (const key of Object.keys(parsed) as DiscoveryRequiredField[]) {
    const value = parsed[key];
    if (value === undefined || (Array.isArray(value) && value.length === 0)) {
      delete parsed[key];
    }
  }
}

function recognizedFieldCount(parsed: PartialDiscoveryQuery): number {
  return Object.keys(parsed).length;
}

function normalizeText(input: string): string {
  return input
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/gu, "е")
    .replace(/[\u00a0\u202f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function assertValidToday(today: Date): void {
  if (!(today instanceof Date) || Number.isNaN(today.getTime())) {
    throw new TypeError("options.today must be a valid Date");
  }
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
