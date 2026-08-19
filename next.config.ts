import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /**
   * Защита от рассинхрона вкладки и сервера.
   *
   * Идентификаторы Server Actions меняются с каждой сборкой, поэтому открытая
   * вкладка после выкладки начинает слать серверу идентификаторы, которых он
   * уже не знает: в логах «Failed to find Server Action», а человек видит
   * «Не удалось сохранить реакцию». Так и случилось на прогоне демонстрации.
   *
   * deploymentId заставляет клиент при несовпадении сделать полную
   * перезагрузку вместо клиентского перехода — вкладка сама подтянет новую
   * сборку. Значение берётся из окружения на этапе сборки.
   */
  deploymentId: process.env.DEPLOYMENT_VERSION,
  outputFileTracingExcludes: {
    "/*": [
      "./.github/**/*",
      "./data/**/*",
      "./docs/**/*",
      "./eval/**/*",
      "./public/**/*",
      "./scripts/**/*",
      "./SPEC_PLAN/**/*",
      "./src/**/*",
      "./tests/**/*",
      "./*.md",
      "./*.mjs",
      "./*.ts",
      "./*.tsbuildinfo",
      "./.dockerignore",
      "./Dockerfile",
      "./docker-compose*.yml",
      "./package-lock.json",
    ],
  },
  async rewrites() {
    return [{ source: "/health", destination: "/api/health" }];
  },
};

export default nextConfig;
