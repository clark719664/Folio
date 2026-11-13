const {
  chromium,
} = require("C:/Users/lil_c/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
execFileSync(path.join(root, "server/.venv/Scripts/python.exe"), [
  "-c",
  "import fitz; d=fitz.open(); p=d.new_page(); p.insert_text((72,80),'Hello Folio',fontsize=24); p.insert_text((72,120),'A document you can make your own.',fontsize=12); p=d.new_page(); p.insert_text((72,80),'Second page',fontsize=24); d.save(r'" +
    path.join(__dirname, "sample.pdf") +
    "')",
]);
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      "C:/Users/lil_c/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe",
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.FOLIO_URL || "http://127.0.0.1:4320");
  await page.getByRole("button", { name: "Open PDF", exact: true }).waitFor();
  await page.screenshot({ path: path.join(__dirname, "empty.png") });
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles(path.join(__dirname, "sample.pdf"));
  await page
    .getByRole("button", { name: "Hello Folio", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Edit text", exact: true }).click();
  await page.getByRole("button", { name: "Hello Folio", exact: true }).click();
  await page.getByRole("textbox", { name: "Selected text" }).fill("Hello Free");
  await page
    .getByRole("textbox", { name: "Selected text" })
    .fill(
      "This replacement is deliberately too long to fit within the selected span at twenty four points.",
    );
  const rejected = page.waitForResponse(
    (response) =>
      response.url().endsWith("/edit") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Apply change" }).click();
  assert.equal((await rejected).status(), 422);
  await page
    .getByRole("button", { name: "Hello Folio", exact: true })
    .waitFor();
  await page.getByRole("textbox", { name: "Selected text" }).fill("Hello Free");
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/edit") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Apply change" }).click();
  const response = await saved;
  assert.equal(response.status(), 200, await response.text());
  const edited = await response.json();
  const content = await (
    await page.request.get(
      new URL("/api/documents/" + edited.id + "/pages/0/text", page.url()).href,
    )
  ).json();
  assert.match(content.text, /Hello Free/);
  assert.doesNotMatch(content.text, /Hello Folio/);
  await page.getByRole("button", { name: "Hello Free", exact: true }).waitFor();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page
    .getByRole("button", { name: "Hello Folio", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page.getByRole("button", { name: "Hello Free", exact: true }).waitFor();
  await page.getByRole("button", { name: "Search document" }).click();
  await page.getByRole("textbox", { name: "Find in document" }).fill("Second");
  await page.getByRole("button", { name: /Page 2 Second page/ }).click();
  await page
    .getByRole("button", { name: "Second page", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Close search" }).click();
  await page.getByRole("button", { name: "Previous page" }).click();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save a copy" }).click();
  const download = await downloadEvent;
  await download.saveAs(path.join(__dirname, "edited.pdf"));
  execFileSync(path.join(root, "server/.venv/Scripts/python.exe"), [
    "-c",
    "import fitz; d=fitz.open(r'" +
      path.join(__dirname, "edited.pdf") +
      "'); t=d[0].get_text(); assert 'Hello Free' in t; assert 'Hello Folio' not in t",
  ]);

  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("button", { name: /Create a form field/ }).click();
  await page.getByRole("textbox", { name: "Field name" }).fill("fullName");
  await page.getByLabel("Top", { exact: true }).fill("220");
  await page.getByLabel("Bottom", { exact: true }).fill("260");
  let toolResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/tools") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create field", exact: true }).click();
  assert.equal((await toolResponse).status(), 200);
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("button", { name: /Fill forms/ }).click();
  await page.getByLabel(/fullName/).fill("Clark Langlois");
  toolResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/tools") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save form", exact: true }).click();
  const filledResponse = await toolResponse;
  assert.equal(filledResponse.status(), 200);
  const filled = await filledResponse.json();
  const fields = await (
    await page.request.get(
      new URL("/api/documents/" + filled.id + "/forms", page.url()).href,
    )
  ).json();
  assert.equal(fields.fields[0].value, "Clark Langlois");
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page
    .getByRole("button", { name: /Bookmarks Create an outline/ })
    .click();
  await page.getByRole("button", { name: "Add bookmark", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Bookmark 1 title" })
    .fill("Introduction");
  toolResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/tools") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Save bookmarks", exact: true })
    .click();
  const bookmarkResponse = await toolResponse;
  assert.equal(bookmarkResponse.status(), 200);
  const bookmarked = await bookmarkResponse.json();
  const outline = await (
    await page.request.get(
      new URL("/api/documents/" + bookmarked.id + "/bookmarks", page.url())
        .href,
    )
  ).json();
  assert.equal(outline.bookmarks[0][1], "Introduction");
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.screenshot({ path: path.join(__dirname, "tools.png") });
  await page.keyboard.press("Escape");
  await page.screenshot({ path: path.join(__dirname, "editor.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  await page.screenshot({ path: path.join(__dirname, "mobile.png") });
  assert.deepEqual(errors, []);
  console.log(
    "PASS overflow rejection, form creation/filling/reopen, bookmark save/reopen, upload, replace existing text, saved PDF content removal/reopen, undo/redo, all-page search, download, mobile overflow, runtime errors",
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
