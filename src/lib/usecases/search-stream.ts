import type { ParseTravelQueryOptions } from "../discovery/parse";
import { parseTravelQuery } from "../discovery/parse";
import type {
  DiscoveryParseResult,
  DiscoveryQuery,
} from "../discovery/schema";
import { selectDestinations } from "../discovery/select";
import {
  fanOutSearch,
  type FanOutSearchEvent,
  type FanOutSearchOptions,
} from "../search/fanout";

type ParseFailure = Exclude<DiscoveryParseResult, { status: "success" }>;

export type SearchStreamEvent =
  | Extract<FanOutSearchEvent, { type: "card" }>
  | (Exclude<FanOutSearchEvent, { type: "card" }> & { eventId: string });

export type SearchStreamPreparation =
  | ParseFailure
  | {
      status: "ready";
      query: DiscoveryQuery;
      events: AsyncGenerator<FanOutSearchEvent>;
    };

export interface PrepareSearchStreamOptions {
  fallback?: ParseTravelQueryOptions["fallback"];
  today?: Date;
  fanOut?: Omit<FanOutSearchOptions, "candidates" | "query">;
}

export async function prepareSearchStream(
  input: string,
  options: PrepareSearchStreamOptions = {},
): Promise<SearchStreamPreparation> {
  const parsed = await parseTravelQuery(input, {
    today: options.today ?? new Date(),
    fallback: options.fallback,
  });
  if (parsed.status !== "success") return parsed;

  return {
    status: "ready",
    query: parsed.query,
    events: fanOutSearch({
      ...options.fanOut,
      candidates: selectDestinations(parsed.query),
      query: parsed.query,
    }),
  };
}

export function streamEventId(event: FanOutSearchEvent): string {
  if (event.type === "card") return event.eventId;
  if (event.type === "candidate_error") {
    return `candidate-error:${encodeURIComponent(event.destination)}:${event.reason}`;
  }
  if (event.type === "aborted") return `aborted:${event.reason}`;
  return event.type;
}

export function toSearchStreamEvent(
  event: FanOutSearchEvent,
): SearchStreamEvent {
  return event.type === "card"
    ? event
    : { ...event, eventId: streamEventId(event) };
}
