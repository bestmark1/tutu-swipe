import {
  createRanker,
  extractFeatures,
  featureSpreads,
  summarizePreferences,
} from "../ranking";
import type { RankableCard, RankingContext } from "../ranking";
import {
  applySessionReaction,
  createSessionState,
  signSessionState,
  verifySessionState,
  type SessionReaction,
  type SignedSessionState,
} from "../session";

/** Потолок, из которого считается признак доступности, когда бюджет не назван. */
const DEFAULT_BUDGET = 120_000;

/** Правило 9 конституции: объём принимаемого от клиента ограничен сервером. */
const MAX_RANKED_CARDS = 40;

export interface RankedFeed {
  /** Идентификаторы карточек в новом порядке. */
  order: string[];
  /** Города, исключённые дизлайком «не тот город». */
  excludedCities: string[];
  /** Модель просит добрать новые направления. */
  refillRequested: boolean;
  /** Короткая выжимка устойчивых предпочтений без чисел и внутренних терминов. */
  preferenceSummary: string[];
}

export interface ReactionOutcome {
  session: SignedSessionState;
  feed: RankedFeed;
}

export function createSignedSwipeSession({
  sessionId,
  createdAt,
}: {
  sessionId: string;
  createdAt?: string;
}): SignedSessionState {
  return signSessionState(createSessionState({ sessionId, createdAt }));
}

/**
 * Принимает реакцию и возвращает новый порядок ленты.
 *
 * Правило 7 конституции: состояние ранжировщика пересчитывается здесь, из
 * журнала реакций, а не принимается от клиента готовым. Клиент присылает только
 * карточки — без них нельзя извлечь признаки, — а веса выводятся заново на
 * каждом вызове. Подделать их, подменив что-то на клиенте, невозможно.
 */
export function addSignedSwipeReaction(
  submission: unknown,
  reaction: SessionReaction,
  cards: readonly RankableCard[] = [],
): ReactionOutcome {
  // Карточки приходят от клиента, и TypeScript тут ничего не гарантирует:
  // прийти может что угодно. Кривые записи отбрасываются молча — ранжирование
  // не то место, где стоит валить весь запрос из-за одной битой карточки.
  const pool = asRankableCards(cards).slice(0, MAX_RANKED_CARDS);
  const context = rankingContext(pool);
  const cardsById = new Map(
    pool.filter((card) => card.id !== undefined).map((card) => [card.id!, card]),
  );

  // Пересчёт идёт ровно один раз: applySessionReaction сам зовёт эту функцию
  // на итоговом журнале и кладёт результат в session.rankingState.
  const reactedCard = cardsById.get(reaction.cardId);
  const normalizedReaction = withoutLearningSignal(reaction);
  const enrichedReaction =
    reactedCard &&
    !(normalizedReaction.type === "dislike" &&
      normalizedReaction.reason === "wrong_city")
      ? {
          ...normalizedReaction,
          learningSignal: {
            features: extractFeatures(reactedCard, context).map(
              (feature) => Math.round(feature * 10_000) / 10_000,
            ),
            destination: reactedCard.destination,
          },
        }
      : normalizedReaction;
  const applied = applySessionReaction(submission, enrichedReaction, (journal) =>
    replayJournal(journal, cardsById, context),
  );
  if (!applied.ok) throw new Error(applied.error.code);

  const ranker = applied.session.rankingState;

  return {
    session: applied.signedState,
    feed: {
      order: ranker
        .rank(pool, context)
        .map((card) => card.id)
        .filter((id): id is string => id !== undefined),
      excludedCities: [...ranker.getState().excludedCities],
      refillRequested: ranker.shouldRefill(),
      preferenceSummary: summarizePreferences(
        ranker.getWeights(),
        preferenceReactionCount(applied.session.state.reactions, cardsById),
        featureSpreads(pool, context),
      ),
    },
  };
}

/** Ранжирует новый пул по уже подписанным реакциям, не добавляя новую. */
export function rankSignedSwipeFeed(
  submission: unknown,
  cards: readonly RankableCard[] = [],
): RankedFeed {
  const verified = verifySessionState(submission);
  if (!verified.ok) throw new Error(verified.error.code);

  const pool = asRankableCards(cards).slice(0, MAX_RANKED_CARDS);
  const context = rankingContext(pool);
  const cardsById = new Map(
    pool.filter((card) => card.id !== undefined).map((card) => [card.id!, card]),
  );
  const ranker = replayJournal(verified.state.reactions, cardsById, context);
  return {
    order: ranker
      .rank(pool, context)
      .map((card) => card.id)
      .filter((id): id is string => id !== undefined),
    excludedCities: [...ranker.getState().excludedCities],
    refillRequested: ranker.shouldRefill(),
    preferenceSummary: summarizePreferences(
      ranker.getWeights(),
      preferenceReactionCount(verified.state.reactions, cardsById),
      featureSpreads(pool, context),
    ),
  };
}

export function undoSignedSwipeReaction(
  submission: unknown,
): SignedSessionState {
  const verified = verifySessionState(submission);
  if (!verified.ok) throw new Error(verified.error.code);

  return signSessionState({
    ...verified.state,
    reactions: verified.state.reactions.slice(0, -1),
  });
}

/**
 * Прогоняет журнал реакций через свежий ранжировщик. Реакции на карточки,
 * которых нет в присланном пуле, пропускаются: журнал живёт дольше ленты, и
 * после нового поиска старые идентификаторы уже ничего не значат.
 */
function replayJournal(
  journal: readonly SessionReaction[],
  cardsById: ReadonlyMap<string, RankableCard>,
  context: RankingContext,
) {
  const ranker = createRanker({ strategy: "bayesian", seed: 42 });
  for (const entry of journal) {
    if (entry.learningSignal) {
      ranker.reactFeatures(
        entry,
        entry.learningSignal.features,
        entry.learningSignal.destination,
      );
      continue;
    }
    const card = cardsById.get(entry.cardId);
    if (!card) continue;
    ranker.react(entry, card, context);
  }
  return ranker;
}

function asRankableCards(value: unknown): RankableCard[] {
  if (!Array.isArray(value)) return [];
  return value.filter((card): card is RankableCard => {
    if (typeof card !== "object" || card === null) return false;
    const candidate = card as Partial<RankableCard>;
    return (
      typeof candidate.id === "string" &&
      typeof candidate.destination === "string" &&
      (candidate.locationType === undefined ||
        typeof candidate.locationType === "string") &&
      typeof candidate.price?.total?.amount === "number" &&
      Number.isFinite(candidate.price.total.amount) &&
      typeof candidate.transport?.transport === "string" &&
      typeof candidate.transport?.durationMinutes === "number" &&
      Number.isFinite(candidate.transport.durationMinutes) &&
      Array.isArray(candidate.transport?.legs) &&
      typeof candidate.hotel === "object" &&
      candidate.hotel !== null
    );
  });
}

function withoutLearningSignal(reaction: SessionReaction): SessionReaction {
  const base = {
    id: reaction.id,
    cardId: reaction.cardId,
    occurredAt: reaction.occurredAt,
  };
  return reaction.type === "like"
    ? { ...base, type: "like" }
    : { ...base, type: "dislike", reason: reaction.reason };
}

/** Считает только реакции, которые действительно обновили веса признаков. */
function preferenceReactionCount(
  journal: readonly SessionReaction[],
  cardsById: ReadonlyMap<string, RankableCard>,
): number {
  return journal.filter(
    (reaction) =>
      reaction.learningSignal !== undefined ||
      (cardsById.has(reaction.cardId) &&
        !(reaction.type === "dislike" && reaction.reason === "wrong_city")),
  ).length;
}

/** Потолок цены для признака доступности: самая дорогая карточка пула. */
function rankingContext(cards: readonly RankableCard[]): RankingContext {
  const amounts = cards.map((card) => card.price.total.amount);
  const budget = amounts.length > 0 ? Math.max(...amounts) : DEFAULT_BUDGET;
  return { budget: budget > 0 ? budget : DEFAULT_BUDGET };
}
