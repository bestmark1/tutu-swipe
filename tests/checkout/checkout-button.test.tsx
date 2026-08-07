import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CheckoutButton } from "@/app/list/checkout-button";

const checkoutRef = {
  transport: "avia",
  search_results_url: "https://avia.tutu.ru/f/Moskva/Sochi/",
  offer_hash: "offer",
  passengers_full: 2,
  passengers_child: 1,
  passengers_infant: 0,
};

describe("checkout button", () => {
  it("AC36: shows the offer's multi-PNR notice before checkout", () => {
    render(
      <CheckoutButton
        checkoutRef={checkoutRef}
        isMultiPnr
        multiPnrNote="Билеты оформляются раздельно двумя заказами"
        fetcher={vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined))}
      />,
    );

    expect(
      screen.getByText("Билеты оформляются раздельно двумя заказами"),
    ).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("AC37: prepares the link before click and performs no request from the click handler", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: "ready",
          url: "https://avia.tutu.ru/explicit/avia/direct",
          kind: "deeplink",
          label: "Открыть корзину",
          fallbackUrl: "https://avia.tutu.ru/f/Moskva/Sochi/",
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    render(<CheckoutButton checkoutRef={checkoutRef} fetcher={fetcher} />);

    const link = await screen.findByRole("link", { name: "Открыть корзину" });
    expect(link).toHaveAttribute(
      "href",
      "https://avia.tutu.ru/explicit/avia/direct",
    );
    expect(fetcher).toHaveBeenCalledOnce();

    fireEvent.click(link);

    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("AC38: a preparation request failure still renders a search link and message", async () => {
    render(
      <CheckoutButton
        checkoutRef={checkoutRef}
        fetcher={vi.fn(async () => {
          throw new Error("network");
        })}
      />,
    );

    expect(
      await screen.findByText(/не удалось подготовить точный переход/iu),
    ).toBeVisible();
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "Открыть подборку на Туту" }),
      ).toHaveAttribute("href", "https://avia.tutu.ru/f/Moskva/Sochi/"),
    );
  });
});
