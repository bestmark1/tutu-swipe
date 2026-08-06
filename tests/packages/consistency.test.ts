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

function cardWithArrival(arrivalAt: string | undefined) {
  const { transport, hotel } = fixtureSearches();
  const result = buildTripCard(
    {
      ...transport,
      variants: transport.variants.map((variant, index) =>
        index === 0 ? { ...variant, arrivalAt } : variant,
      ),
    },
    hotel,
  );

  if (result.status !== "built") throw new Error("Expected a trip card");
  return result.card;
}

describe("trip card consistency", () => {
  it("AC14: warns about the fixture arrival at 04:24 in its source timezone", () => {
    const { transport, hotel } = fixtureSearches();

    const result = buildTripCard(transport, hotel);

    expect(result.status).toBe("built");
    if (result.status !== "built") throw new Error("Expected a trip card");
    expect(result.card.warnings).toContainEqual({
      code: "early_arrival",
      message: "Раннее прибытие: заселение до 08:00 может быть недоступно",
      computed: true,
    });
  });

  it("AC14: warns about an arrival at 23:30", () => {
    expect(
      cardWithArrival("2026-09-12T23:30:00-10:00").warnings,
    ).toContainEqual({
      code: "late_arrival",
      message: "Позднее прибытие: заселение после 22:00 может быть недоступно",
      computed: true,
    });
  });

  it("AC14: does not warn about an arrival at 14:00", () => {
    expect(cardWithArrival("2026-09-12T14:00:00+03:00").warnings).toEqual(
      [],
    );
  });

  it("AC14 and constitution rule 1: does not infer local time from UTC", () => {
    expect(cardWithArrival("2026-09-12T23:30:00Z").warnings).toEqual([]);
  });

  it("AC14 and constitution rule 1: does not infer local time without an offset", () => {
    expect(cardWithArrival("2026-09-12T23:30:00").warnings).toEqual([]);
  });

  it.each(["", undefined])(
    "AC14 and constitution rule 1: does not warn when arrival time is %s",
    (arrivalAt) => {
      expect(cardWithArrival(arrivalAt).warnings).toEqual([]);
    },
  );

  it("AC14: warns about a departure before 08:00", () => {
    const { transport, hotel } = fixtureSearches();
    const result = buildTripCard(
      {
        ...transport,
        variants: transport.variants.map((variant, index) =>
          index === 0
            ? {
                ...variant,
                arrivalAt: "2026-09-12T14:00:00+03:00",
                departureAt: "2026-09-10T07:30:00+03:00",
              }
            : variant,
        ),
      },
      hotel,
    );

    expect(result.status).toBe("built");
    if (result.status !== "built") throw new Error("Expected a trip card");
    expect(result.card.warnings).toContainEqual({
      code: "early_departure",
      message: "Ранний отъезд: выселение до 08:00 может быть затруднено",
      computed: true,
    });
  });

  it("AC14: keeps a package built when an arrival warning is present", () => {
    const { transport, hotel } = fixtureSearches();
    const result = buildTripCard(transport, hotel);

    expect(result.status).toBe("built");
    if (result.status !== "built") throw new Error("Expected a trip card");
    expect(result.card.warnings.length).toBeGreaterThan(0);
  });

  it("AC17: carries the locality and region selected by the server", () => {
    const { transport, hotel } = fixtureSearches();
    const result = buildTripCard(transport, hotel);

    expect(result.status).toBe("built");
    if (result.status !== "built") throw new Error("Expected a trip card");
    expect(result.card.selectedDestination).toEqual({
      name: "Сочи",
      region: "городской округ Сочи, Краснодарский край",
    });
  });

  it("AC17: preserves a null region without breaking the card", () => {
    const { transport, hotel } = fixtureSearches();
    const result = buildTripCard(
      {
        ...transport,
        meta: {
          ...transport.meta,
          to: { name: "Пушкин", region: null },
        },
      },
      hotel,
    );

    expect(result.status).toBe("built");
    if (result.status !== "built") throw new Error("Expected a trip card");
    expect(result.card.selectedDestination).toEqual({
      name: "Пушкин",
      region: null,
    });
  });

  it("AC17: carries also_named as an additional ambiguity signal when supplied", () => {
    const { transport, hotel } = fixtureSearches();
    const result = buildTripCard(
      {
        ...transport,
        meta: {
          ...transport.meta,
          to: {
            name: "Ростов-на-Дону",
            region: "Ростовская область",
            also_named: ["Ростов Великий"],
          },
        },
      },
      hotel,
    );

    expect(result.status).toBe("built");
    if (result.status !== "built") throw new Error("Expected a trip card");
    expect(result.card.selectedDestination).toEqual({
      name: "Ростов-на-Дону",
      region: "Ростовская область",
      alsoNamed: ["Ростов Великий"],
    });
  });
});
