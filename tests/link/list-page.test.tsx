import { render, screen, waitFor } from "@testing-library/react";
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
});
