import { describe, expect, it, vi } from "vitest";

import {
  prepareCheckoutLink,
  type CheckoutLinkInput,
} from "@/lib/mcp/checkout";
import type { McpToolInvoker } from "@/lib/mcp";

function toolResult(payload: unknown, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError,
  };
}

function aviaRoundTripRef() {
  return {
    transport: "avia",
    search_results_url:
      "https://avia.tutu.ru/f/Moskva/Sochi/?route=round-trip",
    departure_geo_city_id: 491,
    arrival_geo_city_id: 134,
    departure_at: "2026-09-10T08:00:00+03:00",
    return_departure_at: "2026-09-14T18:00:00+03:00",
    is_round_trip: true,
    service_class: "ECONOMIC",
    offer_hash: "direct-round-trip-offer",
    passengers_full: 2,
    passengers_child: 1,
    passengers_infant: 0,
  } satisfies CheckoutLinkInput["checkoutRef"];
}

describe("checkout link preparation", () => {
  it("AC34: labels a direct avia round-trip deeplink as a cart", async () => {
    const result = await prepareCheckoutLink(
      { checkoutRef: aviaRoundTripRef() },
      {
        invoker: vi.fn(async () =>
          toolResult({
            checkout_url: "https://avia.tutu.ru/explicit/avia/direct",
            kind: "deeplink",
          }),
        ),
      },
    );

    expect(result).toMatchObject({
      status: "ready",
      kind: "deeplink",
      label: "Открыть корзину",
      url: "https://avia.tutu.ru/explicit/avia/direct",
    });
  });

  it("AC34: labels a connecting round-trip search redirect as a Tutu selection", async () => {
    const result = await prepareCheckoutLink(
      { checkoutRef: aviaRoundTripRef() },
      {
        invoker: vi.fn(async () =>
          toolResult({
            checkout_url:
              "https://avia.tutu.ru/f/Moskva/Sochi/?route=round-trip",
            kind: "search_redirect",
          }),
        ),
      },
    );

    expect(result).toMatchObject({
      status: "ready",
      kind: "search_redirect",
      label: "Открыть подборку на Туту",
    });
  });

  it("AC35: forwards the complete passenger composition from checkout_ref", async () => {
    const invoker = vi.fn<McpToolInvoker>(async () =>
      toolResult({
        checkout_url: "https://avia.tutu.ru/explicit/avia/direct",
        kind: "deeplink",
      }),
    );
    const checkoutRef = aviaRoundTripRef();

    await prepareCheckoutLink({ checkoutRef }, { invoker });

    expect(invoker).toHaveBeenCalledOnce();
    expect(invoker.mock.calls[0][0]).toMatchObject({
      name: "create_checkout_link",
      arguments: checkoutRef,
    });
    expect(invoker.mock.calls[0][0].arguments).toMatchObject({
      passengers_full: 2,
      passengers_child: 1,
      passengers_infant: 0,
    });
  });

  it("opens the hotel page when no room rate was selected", async () => {
    const checkoutRef = {
      transport: "hotels",
      hotel_geo_id: "7653053",
      hotel_alias: "otel_sochi_galereya_park",
      check_in: "2026-09-10",
      check_out: "2026-09-14",
      adults: 2,
      children_ages: [7],
      fallback_url:
        "https://hotel.tutu.ru/offers/details?geo_id=7653053",
    };
    const invoker = vi.fn<McpToolInvoker>(async ({ arguments: args }) => {
      expect(args).not.toHaveProperty("offer_pack_hash");
      return toolResult({
        checkout_url:
          "https://hotel.tutu.ru/explicit/hotel/otel_sochi_galereya_park",
        kind: "deeplink",
      });
    });

    const result = await prepareCheckoutLink(
      { checkoutRef },
      { invoker },
    );

    expect(result).toMatchObject({
      status: "ready",
      url: "https://hotel.tutu.ru/explicit/hotel/otel_sochi_galereya_park",
    });
  });

  it.each(["error", "timeout"] as const)(
    "AC38: %s returns a message and the search fallback",
    async (mode) => {
      const invoker: McpToolInvoker =
        mode === "error"
          ? async () => {
              throw new Error("MCP unavailable");
            }
          : async () => new Promise(() => undefined);

      const result = await prepareCheckoutLink(
        { checkoutRef: aviaRoundTripRef() },
        { invoker, timeoutMs: 5 },
      );

      expect(result).toMatchObject({
        status: "fallback",
        kind: "search_redirect",
        label: "Открыть подборку на Туту",
        url: "https://avia.tutu.ru/f/Moskva/Sochi/?route=round-trip",
      });
      if (result.status !== "fallback") throw new Error("Expected fallback");
      expect(result.message).toMatch(/не удалось|не ответил/iu);
    },
  );

  it("AC38: an expired checkout_ref uses search instead of a broken page", async () => {
    const result = await prepareCheckoutLink(
      { checkoutRef: aviaRoundTripRef() },
      {
        invoker: async () =>
          toolResult({ message: "offer expired" }, true),
      },
    );

    expect(result.status).toBe("fallback");
    expect(result.url).toContain("avia.tutu.ru/f/");
    expect(result.url).not.toContain("explicit/avia");
  });
});
