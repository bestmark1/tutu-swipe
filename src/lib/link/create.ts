import {
  acceptSessionState,
  type SessionReaction,
  type ShortlistStatus,
} from "../session";
import { encodeShortlistFragment } from "./codec";
import {
  MAX_SHARE_URL_LENGTH,
  MAX_SHORTLIST_OFFERS,
  type ShortlistOfferRef,
} from "./types";
import type { DiscoveryQuery } from "../discovery/schema";

const FREEZE_AFTER_REACTIONS = 10;

export interface CreateShortlistLinkInput {
  baseUrl: string;
  query: DiscoveryQuery;
  session: unknown;
  selectOffers: (
    journal: readonly SessionReaction[],
  ) => readonly ShortlistOfferRef[];
}

export type CreateShortlistLinkResult =
  | { ok: true; url: string; status: Exclude<ShortlistStatus, "locked"> }
  | {
      ok: false;
      reason: "empty" | "invalid_session" | "locked" | "too_long";
    };

export function createShortlistLink(
  input: CreateShortlistLinkInput,
  secret?: string,
): CreateShortlistLinkResult {
  const accepted = acceptSessionState(
    input.session,
    (journal) => journal,
    secret,
  );
  if (!accepted.ok) return { ok: false, reason: "invalid_session" };
  if (accepted.session.shortlistStatus === "locked") {
    return { ok: false, reason: "locked" };
  }

  const effectiveJournal =
    accepted.session.shortlistStatus === "frozen"
      ? accepted.session.rankingState.slice(0, FREEZE_AFTER_REACTIONS)
      : accepted.session.rankingState;
  const offers = input
    .selectOffers(effectiveJournal)
    .slice(0, MAX_SHORTLIST_OFFERS);
  if (offers.length === 0) return { ok: false, reason: "empty" };

  let url: URL;
  try {
    url = new URL(input.baseUrl);
    url.search = "";
    url.hash = encodeShortlistFragment({ query: input.query, offers }, secret);
  } catch {
    return { ok: false, reason: "invalid_session" };
  }
  if (url.href.length > MAX_SHARE_URL_LENGTH) {
    return { ok: false, reason: "too_long" };
  }

  return {
    ok: true,
    url: url.href,
    status: accepted.session.shortlistStatus,
  };
}
