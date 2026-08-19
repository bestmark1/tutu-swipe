import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteHeader } from "@/app/_components/site-header";
import HelpPage from "@/app/help/page";

describe("help page", () => {
  it("F30: renders the user guide", () => {
    const { container } = render(<HelpPage />);

    expect(container.querySelector("main")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Как пользоваться tutu·swipe" }),
    ).toBeVisible();
  });

  it("F30: explains how to write a phrase", () => {
    render(<HelpPage />);

    expect(
      screen.getByRole("heading", { name: "Как описать поездку" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "«из Москвы на море в сентябре вдвоём до 60 тысяч»",
      ),
    ).toBeVisible();
  });

  it("F30: explains the labels shown in the feed", () => {
    render(<HelpPage />);

    expect(
      screen.getByRole("heading", {
        name: "Что означают подписи в ленте",
      }),
    ).toBeVisible();
    expect(screen.getByText("«· подставлено»")).toBeVisible();
    expect(screen.getByText("«Часть направлений не ответила»")).toBeVisible();
  });

  it("F30: links to help from the product header", () => {
    render(<SiteHeader />);

    expect(screen.getByRole("link", { name: "Помощь" })).toHaveAttribute(
      "href",
      "/help",
    );
  });
});
