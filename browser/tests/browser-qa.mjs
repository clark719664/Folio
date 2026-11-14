import { createRequire } from "node:module";
import { PDFDocument, StandardFonts } from "pdf-lib";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
const {
  chromium,
} = require("C:/Users/lil_c/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const executablePath =
  process.env.CHROMIUM_PATH ||
  "C:/Users/lil_c/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe";
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const source = await PDFDocument.create();
const font = await source.embedFont(StandardFonts.Helvetica);
source
  .addPage([595, 842])
  .drawText("Folio browser verification", { x: 50, y: 750, size: 22, font });
source
  .addPage([595, 842])
  .drawText("Second page", { x: 50, y: 750, size: 22, font });
const form = source.getForm().createTextField("Name");
form.addToPage(source.getPage(0), { x: 50, y: 600, width: 200, height: 30 });
const fixture = Buffer.from(await source.save());
try {
  await page.goto(process.env.FOLIO_URL || "http://127.0.0.1:4321/app/");
  await page.getByTestId("open-input").setInputFiles({
    name: "verification.pdf",
    mimeType: "application/pdf",
    buffer: fixture,
  });
  await page
    .getByRole("button", { name: "Go to page 2", exact: true })
    .waitFor();
  await page.waitForFunction(
    () => document.querySelector(".paper canvas")?.width > 0,
  );
  await page.getByRole("button", { name: "Rotate page", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Page updated" }).waitFor();
  await page
    .getByRole("button", { name: "Duplicate page", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Go to page 3", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page
    .getByRole("button", { name: "Go to page 3", exact: true })
    .waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page
    .getByRole("button", { name: "Go to page 3", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Fill form", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Browser test");
  await page
    .getByRole("button", { name: "Apply form changes", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Form changes applied" })
    .waitFor();
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  await page
    .getByLabel("Text to add", { exact: true })
    .fill("Added in browser");
  await page
    .locator(".annotation-overlay")
    .click({ position: { x: 120, y: 150 } });
  await page.getByRole("status").filter({ hasText: "Text added" }).waitFor();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  const downloaded = await event;
  const saved = await PDFDocument.load(
    await fs.readFile(await downloaded.path()),
  );
  assert.equal(saved.getPageCount(), 3);
  assert.equal(saved.getForm().getTextField("Name").getText(), "Browser test");
  assert.equal(saved.getPage(0).getRotation().angle, 90);
  await page
    .getByRole("button", { name: "Search document", exact: true })
    .click();
  await page.getByLabel("Find text", { exact: true }).fill("Added in browser");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.locator(".search-result").waitFor();
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await page.getByLabel("Appearance").selectOption("dark");
  await page.screenshot({ path: "tests/browser-dark.png" });
  await page.getByLabel("Appearance").selectOption("light");
  await page.screenshot({ path: "tests/browser-light.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({ path: "tests/browser-mobile.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: open/render, rotate, duplicate, undo/redo, fill, annotate, saved PDF contents, search, themes, mobile overflow, no uncaught browser errors.",
  );
} catch (error) {
  console.error("QA original failure:", error.message);
  try {
    console.error(
      "QA browser diagnostics:",
      JSON.stringify(
        {
          errors,
          alert: await page.locator('[role="alert"]').allTextContents(),
          status: await page.locator('[role="status"]').allTextContents(),
          thumbnails: await page.locator(".thumbnail").count(),
          body: (await page.locator("body").innerText()).slice(0, 5000),
        },
        null,
        2,
      ),
    );
    await page.screenshot({ path: "tests/browser-failure.png" });
  } catch (diagnosticError) {
    console.error("Diagnostics unavailable:", diagnosticError.message);
  }
  throw error;
} finally {
  await browser.close();
}
