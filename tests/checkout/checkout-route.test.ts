import { beforeEach, describe, expect, it, vi } from "vitest";

const { prepareCheckoutLink } = vi.hoisted(() => ({
  prepareCheckoutLink: vi.fn(),
}));

vi.mock("@/lib/mcp/checkout", () => ({ prepareCheckoutLink }));

import { POST } from "@/app/api/checkout/route";

beforeEach(() => {
  prepareCheckoutLink.mockReset();
});

describe("checkout API", () => {
  it("passes checkout_ref and fallback to advance preparation", async () => {
    const checkoutRef = {
      transport: "avia",
      offer_hash: "offer",
      passengers_full: 2,
      passengers_child: 1,
      passengers_infant: 0,
    };
    prepareCheckoutLink.mockResolvedValue({
      status: "ready",
      url: "https://avia.tutu.ru/explicit/avia/direct",
      fallbackUrl: "https://avia.tutu.ru/f/Moskva/Sochi/",
      kind: "deeplink",
      label: "Открыть корзину",
    });

    const response = await POST(
      new Request("http://localhost/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          checkoutRef,
          fallbackUrl: "https://avia.tutu.ru/f/Moskva/Sochi/",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(prepareCheckoutLink).toHaveBeenCalledOnce();
    expect(prepareCheckoutLink).toHaveBeenCalledWith(
      expect.objectContaining({
        checkoutRef,
        fallbackUrl: "https://avia.tutu.ru/f/Moskva/Sochi/",
      }),
    );
  });

  it("rejects a checkout request without a product type", async () => {
    const response = await POST(
      new Request("http://localhost/api/checkout", {
        method: "POST",
        body: JSON.stringify({ checkoutRef: { offer_hash: "offer" } }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "invalid_checkout_request",
    });
    expect(prepareCheckoutLink).not.toHaveBeenCalled();
  });
});
