import { describe, expect, it, vi } from "vitest";

import {
  normalizeToolResult,
  type HotelSearchDto,
  type McpClient,
  type McpToolResult,
  type TransportSearchDto,
} from "@/lib/mcp";
import {
  PHASE_ONE_DESTINATIONS,
  searchOnce,
} from "@/lib/usecases/search-once";
import hotelFixture from "../fixtures/mcp/search-hotels-sochi.json";
import transportFixture from "../fixtures/mcp/search-multitransport-msk-sochi.json";

const COMPLETE_QUERY =
  "Из Москвы, двое взрослых, в сентябре на 4 ночи, до 60000 рублей, море";
const TODAY = new Date("2026-08-05T00:00:00.000Z");

function fixtureSearches() {
  const transport = normalizeToolResult(
    transportFixture.result as McpToolResult,
  );
  const hotel = normalizeToolResult(hotelFixture.result as McpToolResult);

  if (transport.data.type !== "transport" || hotel.data.type !== "hotel") {
    throw new Error("Expected transport and hotel fixture DTOs");
  }

  return { transport: transport.data, hotel: hotel.data };
}

function clientReturning(
  transport: TransportSearchDto,
  hotel: HotelSearchDto,
): McpClient {
  return {
    callTool: vi.fn(async ({ name }) => ({
      status: "success" as const,
      data: name === "search_hotels" ? hotel : transport,
      attempts: 1,
    })),
  };
}

describe("searchOnce", () => {
  it("AC2: returns a clarification and does not start MCP search when origin is missing", async () => {
    const client: McpClient = { callTool: vi.fn() };

    const result = await searchOnce(
      "Двое взрослых, в сентябре на 4 ночи, до 60000 рублей, море",
      { client, today: TODAY },
    );

    expect(result.status).toBe("needs_clarification");
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it("builds one card for every phase-one destination after a successful parse", async () => {
    const { transport, hotel } = fixtureSearches();
    const client = clientReturning(transport, hotel);

    const result = await searchOnce(COMPLETE_QUERY, { client, today: TODAY });

    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("Expected cards");
    expect(result.cards.map(({ destination }) => destination)).toEqual(
      PHASE_ONE_DESTINATIONS,
    );
    expect(result.cards).toHaveLength(3);
    expect(result.cards[0]).toMatchObject({
      tutuUrl: transport.variants[0].checkoutUrl,
      linkKind: "checkout",
      price: {
        total: { amount: 27355.58, currency: "RUB", computed: true },
      },
    });
    expect(client.callTool).toHaveBeenCalledTimes(6);
  });

  it("skips a destination without offers and keeps cards from the others", async () => {
    const { transport, hotel } = fixtureSearches();
    const client: McpClient = {
      callTool: vi.fn(async ({ name, arguments: args }) => {
        const destination = args?.destination ?? args?.city_name;
        const data =
          name === "search_hotels"
            ? hotel
            : destination === PHASE_ONE_DESTINATIONS[1]
              ? { ...transport, variants: [] }
              : transport;
        return { status: "success" as const, data, attempts: 1 };
      }),
    };

    const result = await searchOnce(COMPLETE_QUERY, { client, today: TODAY });

    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("Expected cards");
    expect(result.cards.map(({ destination }) => destination)).toEqual([
      PHASE_ONE_DESTINATIONS[0],
      PHASE_ONE_DESTINATIONS[2],
    ]);
  });

  it("distinguishes full source unavailability from a valid empty search", async () => {
    const { transport, hotel } = fixtureSearches();
    const unavailableClient: McpClient = {
      callTool: vi.fn().mockResolvedValue({
        status: "source_unavailable",
        failure: { kind: "network" },
        attempts: 1,
      }),
    };
    const emptyClient = clientReturning(
      { ...transport, variants: [] },
      { ...hotel, hotels: [] },
    );

    const unavailable = await searchOnce(COMPLETE_QUERY, {
      client: unavailableClient,
      today: TODAY,
    });
    const empty = await searchOnce(COMPLETE_QUERY, {
      client: emptyClient,
      today: TODAY,
    });

    expect(unavailable.status).toBe("source_unavailable");
    expect(empty.status).toBe("no_offers");
  });
});
