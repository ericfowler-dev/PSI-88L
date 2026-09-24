import { test, expect } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
test("desktop and mobile: create workspace, retain PDFs and notes, publish, search, attach, configure", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const setup = await page.request.get("/api/session");
  const session = await setup.json();
  if (session.needsSetup) {
    await expect(page.getByRole("heading", { name: "Create your workspace" })).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill("QA Administrator");
    await page.getByLabel("Email", { exact: true }).fill("qa@example.test");
    await page.getByLabel(/^Password/).fill("browser-test-password-123");
    if (session.setupTokenRequired)
      await page.getByLabel("Setup token").fill("local-verification-token");
    await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  } else {
    await page.getByLabel("Email", { exact: true }).fill("qa@example.test");
    await page.getByLabel(/^Password/).fill("browser-test-password-123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await page.getByRole("button", { name: "New case", exact: true }).first().click();
  await expect(
    page.getByRole("heading", { name: "Technical support, grounded in your knowledge." }),
  ).toBeVisible();
  await mkdir("screenshots", { recursive: true });
  await page.screenshot({ path: "screenshots/desk-desktop.png", fullPage: true });
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Write a note" }).click();
  const title = `Commissioning record ${Date.now()}`;
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page
    .getByLabel("Source / applicability")
    .fill("Browser verification fixture; not operational instructions");
  await page
    .getByLabel("Knowledge text")
    .fill(
      `HT coolant commissioning marker is QUARTZ-88.\nLT circuit review recorded on the worksheet.\nStarter and no-crank observations are retained in the case.\nRun: ${title}`,
    );
  await page.getByRole("button", { name: "Save for review" }).click();
  await expect(
    page.getByText("HT coolant commissioning marker is QUARTZ-88.", { exact: false }).last(),
  ).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Publish knowledge" }).click();
  await expect(page.getByText("Published. Future answers can retrieve this source.")).toBeVisible();
  const found = await page.request.post("/api/knowledge/search", {
    data: { question: "HT commissioning" },
  });
  expect(
    (await found.json()).sources.some((s: { content: string }) => s.content.includes("QUARTZ-88")),
  ).toBe(true);
  await page.reload();
  await expect(page.getByRole("button", { name: new RegExp(title) })).toBeVisible();
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pdfPage = pdf.addPage();
  pdfPage.drawText("PDF verification reference: QUARTZ-77 commissioning evidence.", {
    x: 40,
    y: 700,
    font,
    size: 14,
  });
  await page.getByLabel("Upload library files").setInputFiles({
    name: `verification-${Date.now()}.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await expect(
    page
      .getByText("PDF verification reference: QUARTZ-77 commissioning evidence.", { exact: false })
      .last(),
  ).toBeVisible();
  await expect(page.getByText(/Page 1 · lines/).last()).toBeVisible();
  await page.screenshot({ path: "screenshots/library-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "screenshots/library-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole("link", { name: "Desk", exact: true }).click();
  await page.getByLabel("Case attachment files").setInputFiles({
    name: "events.log",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "2026-09-23T12:00:00Z EVENT_ALPHA recorded\n2026-09-23T12:01:00Z EVENT_BETA recorded",
    ),
  });
  await expect(page.getByText("Ready for case", { exact: false })).toBeVisible();
  await page.screenshot({ path: "screenshots/desk-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Connections & settings" })).toBeVisible();
  await expect(
    page.getByText("Persistent local PostgreSQL (PGlite)", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "screenshots/settings-desktop.png", fullPage: true });
  let evidence = "";
  const provider = createServer(async (request, response) => {
    if (request.url === "/v1/models") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "browser-verification-model" }] }));
      return;
    }
    let raw = "";
    for await (const chunk of request) raw += chunk;
    evidence = JSON.parse(raw).messages[0].content;
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Browser verification: the retained marker is QUARTZ-88 [S1]." } }] })}\n\ndata: [DONE]\n\n`,
    );
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  try {
    const port = (provider.address() as { port: number }).port;
    await page.getByRole("combobox", { name: "Provider", exact: true }).selectOption("compatible");
    await page.getByLabel("Model ID").fill("browser-verification-model");
    await page.getByLabel("API base URL").fill(`http://127.0.0.1:${port}/v1`);
    await page.getByLabel("API key", { exact: true }).fill("browser-verification-key");
    await page.getByRole("button", { name: "Save connection" }).click();
    await expect(page.getByText(/Connection settings saved/)).toBeVisible();
    await page.getByRole("button", { name: "Check saved connection" }).click();
    await expect(
      page.getByText(/API key accepted and browser-verification-model is listed/),
    ).toBeVisible();
    await page.getByRole("link", { name: "Desk", exact: true }).click();
    await page.getByLabel("Question for the desk").fill("What is the HT commissioning marker?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByText(/Browser verification: the retained marker/)).toBeVisible();
    await expect(page.getByText("EVIDENCE IN CONTEXT")).toHaveCount(0);
    const conversation = await page.getByRole("region", { name: "Conversation" }).boundingBox();
    expect(conversation!.width).toBeGreaterThan(1440 * 0.8);
    expect(conversation!.height).toBeGreaterThan(1000 * 0.6);
    const references = page.locator("details").last();
    await expect(references).not.toHaveAttribute("open");
    await references.locator("summary").click();
    await expect(references.getByRole("link").first()).toBeVisible();
    await references.locator("summary").click();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
    expect(evidence).toContain("QUARTZ-88");
    await page.reload();
    await expect(page.getByText(/Browser verification: the retained marker/)).toBeVisible();
    await page.screenshot({ path: "screenshots/answer-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "screenshots/answer-mobile.png", fullPage: true });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  } finally {
    await page.request
      .put("/api/settings", {
        data: { provider: "openai", model: "not-configured", clearKey: true },
      })
      .catch(() => {});
    await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
  expect(errors).toEqual([]);
});

test("long manual progress, passage preview, and failed-upload recovery controls", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("qa@example.test");
  await page.getByLabel(/^Password/).fill("browser-test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Library", exact: true }).click();
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= 205; n++)
    pdf
      .addPage()
      .drawText(`Diagnostic manual page ${n} retained reference for browser verification.`, {
        x: 30,
        y: 700,
        size: 10,
        font,
      });
  await page.getByLabel("Upload library files").setInputFiles({
    name: `long-manual-${Date.now()}.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await expect(
    page.getByRole("status").filter({ hasText: /Processed \d+ of 205 pages/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish knowledge" })).toHaveCount(0);
  await page.screenshot({ path: "screenshots/manual-progress-desktop.png", fullPage: true });
  await expect(page.getByRole("button", { name: "Publish knowledge" })).toBeVisible({
    timeout: 60000,
  });
  await expect(page.getByText("Extracted evidence · 205 passages")).toBeVisible();
  await expect(page.locator("article")).toHaveCount(50);
  await page.getByRole("button", { name: /Show more passages/ }).click();
  await expect(page.locator("article")).toHaveCount(100);
  await page.getByRole("button", { name: "Correct / add text" }).click();
  await page.getByLabel("Reviewed transcription").fill("");
  await expect(page.getByRole("button", { name: "Save revision for review" })).toBeDisabled();
  await page.getByRole("button", { name: "Cancel edit" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "screenshots/manual-review-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByLabel("Upload library files").setInputFiles({
    name: `broken-${Date.now()}.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\ninvalid fixture"),
  });
  await expect(page.getByRole("button", { name: "Retry processing" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Correct / add text" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save for review", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Publish knowledge" })).toBeDisabled();
  await expect(page.getByText(/Retry the retained original; no re-upload is needed/)).toBeVisible();
});
