import {
  destinationCatalog,
  type Destination,
  type LocationType,
  type PriceClass,
  type ReachabilityClass,
} from "./catalog";
import type { DiscoveryQuery, VibeTag } from "./schema";

const MIN_CANDIDATES = 3;
const MAX_CANDIDATES = 8;

const PRICE_CLASS_LIMITS: Record<PriceClass, number> = {
  low: 35_000,
  medium: 70_000,
  high: 120_000,
};

const PRICE_CLASS_ORDER: Record<PriceClass, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

const REACHABILITY_SCORE: Record<ReachabilityClass, number> = {
  easy: 12,
  medium: 6,
  long: 0,
};

export interface DestinationCandidate extends Destination {
  aboveBudget: boolean;
  isFallback: boolean;
}

export interface DestinationPage {
  candidates: DestinationCandidate[];
  /** Страница жилья для текущего прохода по направлениям. */
  hotelPage: number;
}

interface ScoredDestination {
  destination: Destination;
  catalogIndex: number;
  aboveBudget: boolean;
  score: number;
}

export function selectDestinations(
  query: DiscoveryQuery,
): DestinationCandidate[] {
  const travelMonths = monthsInWindow(
    query.dateWindow.startDate,
    query.dateWindow.nights,
  );
  const scored = destinationCatalog
    .map((destination, catalogIndex): ScoredDestination => {
      // Бюджет может отсутствовать: человек не назвал сумму, и потолка нет.
      // Тогда ни одно направление не считается слишком дорогим.
      const aboveBudget =
        query.budget !== undefined &&
        PRICE_CLASS_LIMITS[destination.priceClass] > query.budget.amount;
      return {
        destination,
        catalogIndex,
        aboveBudget,
        score: destinationScore(destination, query, travelMonths),
      };
    })
    .filter(
      ({ destination }) =>
        normalizeCity(destination.name) !== normalizeCity(query.origin),
    );

  const regularSelection = selectScoredDestinations(scored, query);
  if (!query.namedDestinations || query.namedDestinations.length === 0) {
    return regularSelection;
  }

  const scoredByName = new Map(
    scored.map((candidate) => [normalizeCity(candidate.destination.name), candidate]),
  );
  const namedCandidates: DestinationCandidate[] = [];
  const namedNames = new Set<string>();
  for (const name of query.namedDestinations) {
    const normalizedName = normalizeCity(name);
    const candidate = scoredByName.get(normalizedName);
    if (!candidate || namedNames.has(normalizedName)) continue;
    namedNames.add(normalizedName);
    namedCandidates.push(toCandidate(candidate, false));
  }

  // Человек назвал город — значит он выбрал, и подбор ему не нужен. Раньше к
  // названному Сочи подмешивались Туапсе и Ейск: формально «похожие», а по сути
  // не то, о чём просили. Показываем только названное; если ни одно название не
  // нашлось в каталоге, возвращаемся к обычному подбору, иначе лента будет пуста.
  if (namedCandidates.length > 0) return namedCandidates;
  return regularSelection;
}

/**
 * Разбивает каталог на последовательные порции для дозабора. После полного
 * прохода по направлениям начинает следующий круг с новой страницей жилья.
 * Нулевая страница строго совпадает с обычным первым подбором.
 */
export function selectDestinationPage(
  query: DiscoveryQuery,
  {
    page,
    excludedDestinations = [],
  }: {
    page: number;
    excludedDestinations?: readonly string[];
  },
): DestinationPage {
  if (!Number.isSafeInteger(page) || page < 0) {
    throw new TypeError("page must be a non-negative safe integer");
  }

  const excluded = new Set(excludedDestinations.map(normalizeCity));
  const selected = selectDestinations(query);
  const initial = selected.filter(
    ({ name }) => !excluded.has(normalizeCity(name)),
  );
  const initialNames = new Set(initial.map(({ name }) => normalizeCity(name)));

  // Для явно названных направлений ассортимент расширяется жильём, а не
  // подмешиванием других городов: каждый дозабор берёт следующую hotel page.
  const named = new Set(query.namedDestinations?.map(normalizeCity) ?? []);
  if (selected.some(({ name }) => named.has(normalizeCity(name)))) {
    return { candidates: initial, hotelPage: page + 1 };
  }

  const ordered = orderedRegularCandidates(query).filter(
    ({ name }) => !excluded.has(normalizeCity(name)),
  );
  const remaining = ordered.filter(
    ({ name }) => !initialNames.has(normalizeCity(name)),
  );
  const batches = [
    initial,
    ...chunk(remaining, MAX_CANDIDATES),
  ].filter((batch) => batch.length > 0);
  if (batches.length === 0) return { candidates: [], hotelPage: 1 };

  const batchIndex = page % batches.length;
  return {
    candidates: batches[batchIndex]!,
    hotelPage: Math.floor(page / batches.length) + 1,
  };
}

function selectScoredDestinations(
  scored: ScoredDestination[],
  query: DiscoveryQuery,
): DestinationCandidate[] {

  const affordable = scored.filter(({ aboveBudget }) => !aboveBudget);
  const noneAffordable = affordable.length === 0;
  const pool = affordable.length >= MIN_CANDIDATES ? affordable : scored;

  pool.sort((left, right) => {
    if (noneAffordable) {
      const priceDifference =
        PRICE_CLASS_ORDER[left.destination.priceClass] -
        PRICE_CLASS_ORDER[right.destination.priceClass];
      if (priceDifference !== 0) return priceDifference;
    } else if (left.aboveBudget !== right.aboveBudget) {
      return left.aboveBudget ? 1 : -1;
    }

    const scoreDifference = right.score - left.score;
    if (scoreDifference !== 0) return scoreDifference;

    const priceDifference =
      PRICE_CLASS_ORDER[left.destination.priceClass] -
      PRICE_CLASS_ORDER[right.destination.priceClass];
    if (priceDifference !== 0) return priceDifference;

    return left.catalogIndex - right.catalogIndex;
  });

  const selectionPool = noneAffordable
    ? pool.filter(
        ({ destination }) =>
          destination.priceClass === pool[0]?.destination.priceClass,
      )
    : pool;
  const categoryMatches = selectionPool.filter(({ destination }) =>
    matchesRequestedCategory(destination, query.vibeTags),
  );

  if (categoryMatches.length >= MIN_CANDIDATES) {
    return categoryMatches
      .slice(0, MAX_CANDIDATES)
      .map((candidate) => toCandidate(candidate, false));
  }

  const categoryFallbacks = selectionPool
    .filter(({ destination }) =>
      !matchesRequestedCategory(destination, query.vibeTags),
    )
    .slice(0, MIN_CANDIDATES - categoryMatches.length);

  return [
    ...categoryMatches.map((candidate) => toCandidate(candidate, false)),
    ...categoryFallbacks.map((candidate) => toCandidate(candidate, true)),
  ];
}

function orderedRegularCandidates(query: DiscoveryQuery): DestinationCandidate[] {
  const travelMonths = monthsInWindow(
    query.dateWindow.startDate,
    query.dateWindow.nights,
  );
  const scored = destinationCatalog
    .map((destination, catalogIndex): ScoredDestination => ({
      destination,
      catalogIndex,
      aboveBudget:
        query.budget !== undefined &&
        PRICE_CLASS_LIMITS[destination.priceClass] > query.budget.amount,
      score: destinationScore(destination, query, travelMonths),
    }))
    .filter(
      ({ destination }) =>
        normalizeCity(destination.name) !== normalizeCity(query.origin),
    );

  const affordable = scored.filter(({ aboveBudget }) => !aboveBudget);
  const noneAffordable = affordable.length === 0;
  const pool = affordable.length >= MIN_CANDIDATES ? affordable : scored;
  pool.sort(compareScored(noneAffordable));
  const selectionPool = noneAffordable
    ? pool.filter(
        ({ destination }) =>
          destination.priceClass === pool[0]?.destination.priceClass,
      )
    : pool;
  const matching = selectionPool.filter(({ destination }) =>
    matchesRequestedCategory(destination, query.vibeTags),
  );
  const fallback = selectionPool.filter(
    ({ destination }) =>
      !matchesRequestedCategory(destination, query.vibeTags),
  );
  return [
    ...matching.map((candidate) => toCandidate(candidate, false)),
    ...fallback.map((candidate) => toCandidate(candidate, true)),
  ];
}

function compareScored(noneAffordable: boolean) {
  return (left: ScoredDestination, right: ScoredDestination): number => {
    if (noneAffordable) {
      const priceDifference =
        PRICE_CLASS_ORDER[left.destination.priceClass] -
        PRICE_CLASS_ORDER[right.destination.priceClass];
      if (priceDifference !== 0) return priceDifference;
    } else if (left.aboveBudget !== right.aboveBudget) {
      return left.aboveBudget ? 1 : -1;
    }

    const scoreDifference = right.score - left.score;
    if (scoreDifference !== 0) return scoreDifference;
    const priceDifference =
      PRICE_CLASS_ORDER[left.destination.priceClass] -
      PRICE_CLASS_ORDER[right.destination.priceClass];
    return priceDifference !== 0
      ? priceDifference
      : left.catalogIndex - right.catalogIndex;
  };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function toCandidate(
  { destination, aboveBudget }: ScoredDestination,
  isFallback: boolean,
): DestinationCandidate {
  return { ...destination, aboveBudget, isFallback };
}

function matchesRequestedCategory(
  destination: Destination,
  vibeTags: readonly VibeTag[],
): boolean {
  return vibeTags.some(
    (tag) => vibeScore(tag, destination.locationTypes) > 0,
  );
}

function destinationScore(
  destination: Destination,
  query: DiscoveryQuery,
  travelMonths: readonly number[],
): number {
  return (
    query.vibeTags.reduce(
      (score, tag) => score + vibeScore(tag, destination.locationTypes),
      0,
    ) +
    seasonScore(destination.seasonMonths, travelMonths) +
    reachabilityScore(destination, query.origin) +
    (2 - PRICE_CLASS_ORDER[destination.priceClass]) * 4
  );
}

function vibeScore(
  tag: VibeTag,
  locationTypes: readonly LocationType[],
): number {
  if (
    (tag === "sea" ||
      tag === "mountains" ||
      tag === "city" ||
      tag === "nature" ||
      tag === "treatment") &&
    locationTypes.includes(tag)
  ) {
    return 60;
  }

  if (tag === "culture") {
    return locationTypes.includes("city") ? 45 : 0;
  }
  if (tag === "active") {
    return (
      (locationTypes.includes("mountains") ? 40 : 0) +
      (locationTypes.includes("nature") ? 30 : 0) +
      (locationTypes.includes("sea") ? 10 : 0)
    );
  }
  if (tag === "quiet") {
    return (
      (locationTypes.includes("treatment") ? 40 : 0) +
      (locationTypes.includes("nature") ? 30 : 0) +
      (locationTypes.includes("sea") ? 10 : 0)
    );
  }

  return 0;
}

function seasonScore(
  seasonMonths: readonly number[],
  travelMonths: readonly number[],
): number {
  const matchingMonths = travelMonths.filter((month) =>
    seasonMonths.includes(month),
  ).length;
  if (matchingMonths === travelMonths.length) return 30;
  if (matchingMonths > 0) return 10;
  return -40;
}

function reachabilityScore(
  destination: Destination,
  origin: string,
): number {
  const matchingOrigin = Object.entries(destination.reachability).find(
    ([majorOrigin]) => normalizeCity(majorOrigin) === normalizeCity(origin),
  );
  return matchingOrigin ? REACHABILITY_SCORE[matchingOrigin[1]] : 3;
}

function monthsInWindow(startDate: string, nights: number): number[] {
  const [year, month, day] = startDate.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + Math.max(0, nights - 1));

  const months: number[] = [];
  let cursorYear = start.getUTCFullYear();
  let cursorMonth = start.getUTCMonth() + 1;
  const endYear = end.getUTCFullYear();
  const endMonth = end.getUTCMonth() + 1;

  while (
    cursorYear < endYear ||
    (cursorYear === endYear && cursorMonth <= endMonth)
  ) {
    months.push(cursorMonth);
    cursorMonth += 1;
    if (cursorMonth === 13) {
      cursorMonth = 1;
      cursorYear += 1;
    }
  }

  return months;
}

function normalizeCity(city: string): string {
  return city
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replaceAll("ё", "е");
}
