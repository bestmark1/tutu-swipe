import { createRanker } from "../ranking";
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
  const pool = cards.slice(0, MAX_RANKED_CARDS);
  const context = rankingContext(pool);
  const cardsById = new Map(
    pool.filter((card) => card.id !== undefined).map((card) => [card.id!, card]),
  );

  const applied = applySessionReaction(submission, reaction, (journal) =>
    replayJournal(journal, cardsById, context),
  );
  if (!applied.ok) throw new Error(applied.error.code);

  const ranker = replayJournal(
    applied.session.state.reactions,
    cardsById,
    context,
  );

  return {
    session: applied.signedState,
    feed: {
      order: ranker
        .rank(pool, context)
        .map((card) => card.id)
        .filter((id): id is string => id !== undefined),
      excludedCities: [...ranker.getState().excludedCities],
      refillRequested: ranker.shouldRefill(),
    },
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
    const card = cardsById.get(entry.cardId);
    if (!card) continue;
    ranker.react(entry, card, context);
  }
  return ranker;
}

/** Потолок цены для признака доступности: самая дорогая карточка пула. */
function rankingContext(cards: readonly RankableCard[]): RankingContext {
  const amounts = cards.map((card) => card.price.total.amount);
  const budget = amounts.length > 0 ? Math.max(...amounts) : DEFAULT_BUDGET;
  return { budget: budget > 0 ? budget : DEFAULT_BUDGET };
}
