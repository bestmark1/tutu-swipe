import { describe, expect, it } from "vitest";

import { normalizeToolResult, type McpToolResult } from "@/lib/mcp";
import { buildTripCard } from "@/lib/packages/build";
import hotelFixture from "../fixtures/mcp/search-hotels-sochi.json";
import transportFixture from "../fixtures/mcp/search-multitransport-msk-sochi.json";

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

function priceForAmounts(
  transportAmount: number,
  accommodationAmount: number,
) {
  const { transport, hotel } = fixtureSearches();
  const result = buildTripCard(
    {
      ...transport,
      variants: transport.variants.map((variant, index) =>
        index === 0
          ? {
              ...variant,
              price: { ...variant.price, amount: transportAmount },
            }
          : variant,
      ),
    },
    {
      ...hotel,
      hotels: hotel.hotels.map((item, index) =>
        index === 0 && item.bestOffer
          ? {
              ...item,
              bestOffer: {
                ...item.bestOffer,
                price: {
                  ...item.bestOffer.price,
                  amount: accommodationAmount,
                },
              },
            }
          : item,
      ),
    },
  );

  if (result.status !== "built") throw new Error("Expected a trip card");
  return result.card.price;
}

describe("trip card package", () => {
  it("adds 0.1 and 0.2 RUB without a floating-point residue", () => {
    expect(priceForAmounts(0.1, 0.2).total.amount).toBe(0.3);
  });

  it("adds realistic decimal ticket prices without a floating-point residue", () => {
    expect(priceForAmounts(1234.56, 7890.13).total.amount).toBe(9124.69);
  });

  it("keeps the fixture total at 27355.58 RUB", () => {
    const { transport, hotel } = fixtureSearches();
    const result = buildTripCard(transport, hotel);

    expect(result.status).toBe("built");
    if (result.status !== "built") throw new Error("Expected a trip card");
    expect(result.card.price.total.amount).toBe(27355.58);
  });

  it("preserves the original component amounts in the price breakdown", () => {
    const price = priceForAmounts(1234.56, 7890.13);

    expect(price.breakdown.transport.amount).toBe(1234.56);
    expect(price.breakdown.accommodation.amount).toBe(7890.13);
  });

  it("AC12: exposes a computed total and its transport and accommodation components", () => {
    const { transport, hotel } = fixtureSearches();

    const result = buildTripCard(transport, hotel);

    expect(result.status).toBe("built");
    if (result.status !== "built") throw new Error("Expected a trip card");
    expect(result.card.transport).toBe(transport.variants[0]);
    expect(result.card.hotel).toBe(hotel.hotels[0]);
    expect(result.card.price).toEqual({
      total: { amount: 27355.58, currency: "RUB", computed: true },
      breakdown: {
        transport: {
          amount: 4955.58,
          currency: "RUB",
          label: "Дорога",
        },
        accommodation: {
          amount: 22400,
          currency: "RUB",
          label: "Жильё за 4 ночи",
          priceBasis: "stay_total",
        },
      },
    });
  });

  it("AC13: treats stay_total as the full stay price instead of multiplying it by nights", () => {
    const { transport, hotel } = fixtureSearches();

    const result = buildTripCard(transport, hotel);

    expect(result.status).toBe("built");
    if (result.status !== "built") throw new Error("Expected a trip card");
    expect(result.card.price.breakdown.accommodation.amount).toBe(22400);
    expect(result.card.price.breakdown.accommodation.amount).not.toBe(89600);
    expect(result.card.price.total.amount).toBe(4955.58 + 22400);
  });

  it("AC12: labels transport as round-trip only when both legs are present", () => {
    const { transport, hotel } = fixtureSearches();
    const outbound = transport.variants[0].legs[0];
    const roundTripTransport = {
      ...transport,
      variants: [
        {
          ...transport.variants[0],
          legs: [outbound, { ...outbound, label: "return" }],
        },
      ],
    };

    const result = buildTripCard(roundTripTransport, hotel);

    expect(result.status).toBe("built");
    if (result.status !== "built") throw new Error("Expected a trip card");
    expect(result.card.price.breakdown.transport.label).toBe(
      "Дорога туда-обратно",
    );
  });

  it("AC13: uses the number of nights only in the accommodation label", () => {
    const { transport, hotel } = fixtureSearches();
    const changedStay = {
      ...hotel,
      stay: hotel.stay && { ...hotel.stay, nights: 9 },
    };

    const result = buildTripCard(transport, changedStay);

    expect(result.status).toBe("built");
    if (result.status !== "built") throw new Error("Expected a trip card");
    expect(result.card.price.breakdown.accommodation.label).toBe(
      "Жильё за 9 ночей",
    );
    expect(result.card.price.breakdown.accommodation.amount).toBe(22400);
    expect(result.card.price.total.amount).toBe(4955.58 + 22400);
  });

  it("AC15: explicitly skips a direction without accommodation offers", () => {
    const { transport, hotel } = fixtureSearches();

    expect(buildTripCard(transport, { ...hotel, hotels: [] })).toEqual({
      status: "skipped",
      reason: "no_accommodation_offers",
    });
  });

  it("AC15: explicitly skips a direction without transport offers", () => {
    const { transport, hotel } = fixtureSearches();

    expect(buildTripCard({ ...transport, variants: [] }, hotel)).toEqual({
      status: "skipped",
      reason: "no_transport_offers",
    });
  });

  it("does not silently add component prices in different currencies", () => {
    const { transport, hotel } = fixtureSearches();
    const mismatchedHotel = {
      ...hotel,
      hotels: hotel.hotels.map((item, index) =>
        index === 0 && item.bestOffer
          ? {
              ...item,
              bestOffer: {
                ...item.bestOffer,
                price: { ...item.bestOffer.price, currency: "USD" },
              },
            }
          : item,
      ),
    };

    expect(buildTripCard(transport, mismatchedHotel)).toEqual({
      status: "skipped",
      reason: "currency_mismatch",
      currencies: { transport: "RUB", accommodation: "USD" },
    });
  });

  it("CONSTITUTION 1a: marks the total as computed rather than sourced from MCP", () => {
    const { transport, hotel } = fixtureSearches();

    const result = buildTripCard(transport, hotel);

    expect(result.status).toBe("built");
    if (result.status !== "built") throw new Error("Expected a trip card");
    expect(result.card.price.total.computed).toBe(true);
  });

  it("does not assume an unknown accommodation price basis is stay_total", () => {
    const { transport, hotel } = fixtureSearches();
    const hotelWithoutBasis = {
      ...hotel,
      hotels: hotel.hotels.map((item, index) =>
        index === 0 && item.bestOffer
          ? {
              ...item,
              bestOffer: { ...item.bestOffer, priceBasis: undefined },
            }
          : item,
      ),
    };

    expect(buildTripCard(transport, hotelWithoutBasis)).toEqual({
      status: "skipped",
      reason: "unsupported_accommodation_price_basis",
      priceBasis: undefined,
    });
  });
});
