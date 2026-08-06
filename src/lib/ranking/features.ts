import type { RankableCard, RankingContext } from "./interface";

export const FEATURE_NAMES = [
  "affordability",
  "shortTravel",
  "directness",
  "airTransport",
  "railTransport",
  "hotelStars",
  "hotelRating",
  "urbanLocation",
  "leisureLocation",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];
export type FeatureVector = number[];

export const DEFAULT_WEIGHTS: readonly number[] = [
  0.25, 0.45, 0.4, 0.08, 0.08, 0.2, 0.7, 0.08, 0.08,
];

const MINUTES_PER_DAY = 24 * 60;

export function extractFeatures(
  card: RankableCard,
  context: RankingContext,
): FeatureVector {
  if (!Number.isFinite(context.budget) || context.budget <= 0) {
    throw new TypeError("Ranking budget must be a positive finite number");
  }

  const transport = card.transport.transport.toLocaleLowerCase("ru-RU");
  const [urbanLocation, leisureLocation] = locationSignals(card.locationType);

  return [
    clamp(1 - card.price.total.amount / context.budget),
    clamp(1 - card.transport.durationMinutes / MINUTES_PER_DAY),
    1 / (1 + transferCount(card)),
    transportSignal(transport, ["avia", "air", "plane", "самол"]),
    transportSignal(transport, ["rail", "train", "etrain", "поезд"]),
    clamp((card.hotel.stars ?? 2.5) / 5, 0, 1),
    clamp((card.hotel.rating ?? 5) / 10, 0, 1),
    urbanLocation,
    leisureLocation,
  ];
}

export function dotProduct(
  weights: readonly number[],
  features: readonly number[],
): number {
  return weights.reduce(
    (total, weight, index) => total + weight * (features[index] ?? 0),
    0,
  );
}

export function featureDistance(
  first: readonly number[],
  second: readonly number[],
): number {
  return first.reduce((distance, value, index) => {
    const difference = value - (second[index] ?? 0);
    return distance + difference * difference;
  }, 0);
}

function transferCount(card: RankableCard): number {
  return card.transport.legs.reduce(
    (total, leg) => total + Math.max(0, leg.segments.length - 1),
    0,
  );
}

function transportSignal(transport: string, markers: readonly string[]): number {
  return markers.some((marker) => transport.includes(marker)) ? 1 : -0.25;
}

function locationSignals(locationType: string | undefined): [number, number] {
  if (locationType === undefined) return [0.25, 0.25];
  const normalized = locationType.toLocaleLowerCase("ru-RU");
  const urban = ["city", "urban", "locality", "город"].some((marker) =>
    normalized.includes(marker),
  );
  const leisure = [
    "resort",
    "beach",
    "coast",
    "nature",
    "mountain",
    "курорт",
    "пляж",
    "природ",
    "горн",
  ].some((marker) => normalized.includes(marker));
  return [urban ? 1 : 0, leisure ? 1 : 0];
}

function clamp(value: number, minimum = -1, maximum = 1): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(maximum, Math.max(minimum, value));
}
