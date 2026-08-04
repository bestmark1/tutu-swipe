import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

// Пример-тест: доказывает, что тестовый фреймворк настроен.
// Замени на реальные тесты при первой фиче.
function Hello({ name }: { name: string }) {
  return <h1>Привет, {name}</h1>;
}

test("тестовый фреймворк работает: рендер и поиск по роли", () => {
  render(<Hello name="агент" />);
  expect(
    screen.getByRole("heading", { name: /привет, агент/i })
  ).toBeInTheDocument();
});
