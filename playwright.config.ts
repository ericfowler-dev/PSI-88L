import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 90_000,
  expect: { timeout: 30_000 },
  workers: 1,
  use: {
    actionTimeout: 15_000,
    channel: "chromium",
    baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:8081",
    headless: true,
    trace: "retain-on-failure",
  },
});
