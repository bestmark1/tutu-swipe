import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom не реализует scrollIntoView
Element.prototype.scrollIntoView = () => {};

afterEach(() => {
  cleanup();
});
