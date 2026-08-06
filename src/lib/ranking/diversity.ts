import type { RankableCard } from "./interface";
import { normalizeCity } from "./interface";

const DIVERSITY_WINDOW = 5;
const MAX_CARDS_PER_CITY = 2;

export function diversify<TCard extends RankableCard>(
  ranked: readonly TCard[],
): TCard[] {
  const remaining = [...ranked];
  const result: TCard[] = [];

  while (remaining.length > 0) {
    const candidateIndex = remaining.findIndex((candidate) =>
      canAppend(result, candidate),
    );
    if (candidateIndex < 0) break;

    const [candidate] = remaining.splice(candidateIndex, 1);
    if (candidate) result.push(candidate);
  }

  return result;
}

export function respectsDiversity(cards: readonly RankableCard[]): boolean {
  return cards.every((_, index) => {
    if (index + DIVERSITY_WINDOW > cards.length) return true;
    const window = cards.slice(index, index + DIVERSITY_WINDOW);
    const counts = new Map<string, number>();
    for (const card of window) {
      const city = normalizeCity(card.destination);
      counts.set(city, (counts.get(city) ?? 0) + 1);
    }
    return [...counts.values()].every(
      (count) => count <= MAX_CARDS_PER_CITY,
    );
  });
}

function canAppend(
  result: readonly RankableCard[],
  candidate: RankableCard,
): boolean {
  const recent = result.slice(-(DIVERSITY_WINDOW - 1));
  const city = normalizeCity(candidate.destination);
  const sameCity = recent.filter(
    (card) => normalizeCity(card.destination) === city,
  ).length;
  return sameCity < MAX_CARDS_PER_CITY;
}
