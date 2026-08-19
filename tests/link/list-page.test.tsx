import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ListPageClient,
  type OpenSharedList,
} from "@/app/list/list-page-client";

describe("shared list page", () => {
  it.each([
    ["invalid", "Ссылка повреждена"],
    ["unsupported_version", "Версия ссылки не поддерживается"],
  ] as const)("AC33: shows a clear %s link page", async (reason, heading) => {
    window.history.replaceState(null, "", `/list#${reason}`);
    const open = vi.fn<OpenSharedList>(async () => ({
      status: "invalid_link",
      reason,
    }));

    render(<ListPageClient open={open} />);

    expect(await screen.findByRole("heading", { name: heading })).toBeVisible();
    expect(screen.getByText(/попросите отправителя создать новую/iu)).toBeVisible();
  });

  it("AC33b: visibly labels a replacement", async () => {
    window.history.replaceState(null, "", "/list#v1.payload.signature");
    const open = vi.fn<OpenSharedList>(async () => ({
      status: "ready",
      trips: [
        {
          destination: "Сочи",
          hotelName: "Новый отель",
          totalAmount: 52_000,
          currency: "RUB",
          replaced: true,
        },
      ],
    }));

    render(<ListPageClient open={open} />);

    expect(await screen.findByRole("heading", { name: "Сочи" })).toBeVisible();
    expect(screen.getByText("Предложение заменено")).toBeVisible();
    expect(screen.getByRole("link", { name: "Вернуться в ленту" })).toHaveAttribute(
      "href",
      "/swipe",
    );
  });

  it("AC32: opens from the fragment in a cold browser without session or cookies", async () => {
    localStorage.clear();
    document.cookie = "";
    window.history.replaceState(null, "", "/list#v1.payload.signature");
    const open = vi.fn<OpenSharedList>(async () => ({
      status: "ready",
      trips: [
        {
          destination: "Казань",
          hotelName: "Отель Казань",
          totalAmount: 40_000,
          currency: "RUB",
          replaced: false,
        },
      ],
    }));

    render(<ListPageClient open={open} />);

    expect(await screen.findByRole("heading", { name: "Казань" })).toBeVisible();
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith("#v1.payload.signature"),
    );
    expect(localStorage).toHaveLength(0);
  });

  it("F23: links each trip to Tutu when the rebuilt card carries a URL", async () => {
    window.history.replaceState(null, "", "/list#v1.payload.signature");
    const open = vi.fn<OpenSharedList>(async () => ({
      status: "ready",
      trips: [
        {
          destination: "Сочи",
          hotelName: "Отель у моря",
          totalAmount: 52_000,
          currency: "RUB",
          replaced: false,
          tutuUrl: "https://hotel.tutu.ru/sochi/offer/1",
        },
        {
          destination: "Казань",
          hotelName: "Отель Казань",
          totalAmount: 40_000,
          currency: "RUB",
          replaced: false,
        },
      ],
    }));

    render(<ListPageClient open={open} />);

    const link = await screen.findByRole("link", { name: "Смотреть на Туту" });
    expect(link).toHaveAttribute("href", "https://hotel.tutu.ru/sochi/offer/1");
    expect(screen.getAllByRole("link", { name: "Смотреть на Туту" })).toHaveLength(1);
  });

  it("F23: shares the current link via the clipboard", async () => {
    window.history.replaceState(null, "", "/list#v1.payload.signature");
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const open = vi.fn<OpenSharedList>(async () => ({
      status: "ready",
      trips: [
        {
          destination: "Сочи",
          hotelName: "Отель у моря",
          totalAmount: 52_000,
          currency: "RUB",
          replaced: false,
        },
      ],
    }));

    render(<ListPageClient open={open} />);

    fireEvent.click(await screen.findByRole("button", { name: "Поделиться" }));

    expect(screen.getByRole("button", { name: "Поделиться" })).toHaveClass(
      "bg-action",
      "text-white",
    );
    expect(screen.getByText("52 000 ₽")).toHaveClass("text-price", "text-3xl");
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(
      await screen.findByText(/Ссылка скопирована/iu),
    ).toBeVisible();
  });

  it("HTTP deployment constraint: exposes the link when clipboard is unavailable", async () => {
    window.history.replaceState(null, "", "/list#v1.payload.signature");
    Object.defineProperty(window.navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    const open = vi.fn<OpenSharedList>(async () => ({
      status: "ready",
      trips: [
        {
          destination: "Сочи",
          hotelName: "Отель у моря",
          totalAmount: 52_000,
          currency: "RUB",
          replaced: false,
        },
      ],
    }));

    render(<ListPageClient open={open} />);

    fireEvent.click(await screen.findByRole("button", { name: "Поделиться" }));

    expect(await screen.findByText(/скопируйте её вручную/iu)).toBeVisible();
    expect(screen.queryByText(/Ссылка скопирована/iu)).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Ссылка на подборку" })).toHaveValue(
      window.location.href,
    );
  });
});
