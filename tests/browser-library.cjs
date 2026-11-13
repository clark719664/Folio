const {
  chromium,
} = require("C:/Users/lil_c/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const unique = `Library-${Date.now()}`;
const fixture = path.join(__dirname, unique + ".pdf");
execFileSync(path.join(root, "server/.venv/Scripts/python.exe"), [
  "-c",
  `import pymupdf as f;d=f.open();p=d.new_page();p.insert_text((72,80),'Original library text');p=d.new_page();p.insert_text((72,80),'Library second page');d.save(r'${fixture}')`,
]);
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      "C:/Users/lil_c/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe",
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.FOLIO_URL || "http://127.0.0.1:4320");
    await page.getByRole("button", { name: "Open PDF", exact: true }).waitFor();
    await page.locator("input[type=file]").first().setInputFiles(fixture);
    await page
      .getByRole("button", { name: "Original library text", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await page
      .getByRole("button", { name: "Library second page", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Zoom in", exact: true })
      .first()
      .click();
    await page.waitForFunction(() => {
      const state = JSON.parse(
        localStorage.getItem("folio.document-session.v1"),
      );
      return state.page === 1 && state.fitWidth === false;
    });
    const before = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("folio.document-session.v1")),
    );
    await page.reload();
    await page
      .getByRole("button", { name: "Library second page", exact: true })
      .waitFor();
    const after = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("folio.document-session.v1")),
    );
    assert.equal(after.documentId, before.documentId);
    assert.equal(after.page, 1);
    assert.equal(after.zoom, before.zoom);
    assert.equal(after.fitWidth, false);
    await page
      .getByRole("button", { name: "Previous page", exact: true })
      .click();
    await page.getByRole("button", { name: "Edit text", exact: true }).click();
    await page
      .getByRole("button", { name: "Original library text", exact: true })
      .click();
    await page.getByLabel("Selected text").fill("Edited text");
    const editEvent = page.waitForResponse(
      (response) =>
        response.url().endsWith("/edit") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Apply change", exact: true })
      .click();
    const edited = await (await editEvent).json();
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page.getByLabel("Search library").fill(unique);
    const row = page.locator(".library-entry").filter({ hasText: unique });
    await row
      .getByRole("button", {
        name: `Details and history for ${unique}.pdf`,
        exact: true,
      })
      .click();
    await page.getByLabel("Library filename").fill(unique + " renamed.pdf");
    await page.getByLabel("Document folder").fill("Reviews");
    const renamedEvent = page.waitForResponse(
      (response) =>
        response.url().includes("/library/") &&
        response.request().method() === "PATCH",
    );
    await page
      .getByRole("button", { name: "Save document details", exact: true })
      .click();
    assert.equal((await renamedEvent).status(), 200);
    await row
      .getByRole("button", {
        name: `Favorite ${unique} renamed.pdf`,
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Show favorites", exact: true })
      .click();
    await page.getByLabel("Library folder").selectOption("Reviews");
    await row.waitFor();
    const restoreEvent = page.waitForResponse(
      (response) =>
        response.url().endsWith("/restore") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Restore version", exact: true })
      .last()
      .click();
    const restoredResponse = await restoreEvent;
    assert.equal(restoredResponse.status(), 200, await restoredResponse.text());
    const restored = await restoredResponse.json();
    assert.notEqual(restored.id, edited.id);
    await page
      .getByRole("button", { name: "Original library text", exact: true })
      .waitFor();
    const downloadEvent = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save a copy", exact: true })
      .click();
    assert.equal(
      (await downloadEvent).suggestedFilename(),
      unique + " renamed.pdf",
    );
    await page.reload();
    await page
      .getByRole("button", { name: "Original library text", exact: true })
      .waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS reload restores document/page/zoom, library rename/folder/favorite, immutable historic restore, renamed download",
    );
  } finally {
    await browser.close();
    require("node:fs").unlinkSync(fixture);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
