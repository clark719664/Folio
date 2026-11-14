const {
  chromium,
} = require("C:/Users/lil_c/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const base = process.env.FOLIO_URL || "http://127.0.0.1:4320";
const fixtureDir = path.join(__dirname, "../test-results/conversion-fixtures");
fs.mkdirSync(fixtureDir, { recursive: true });
fs.writeFileSync(
  path.join(fixtureDir, "notes.txt"),
  "Conversion heading\n\nA useful PDF made from a plain text file.",
);
fs.writeFileSync(
  path.join(fixtureDir, "unsupported.bad"),
  "This is not a supported file.",
);
execFileSync(path.join(__dirname, "../server/.venv/Scripts/python.exe"), [
  "-c",
  `from PIL import Image;import zipfile,pathlib;p=pathlib.Path(r'${fixtureDir}');Image.new('RGB',(320,180),(70,130,180)).save(p/'picture.png');z=zipfile.ZipFile(p/'letter.docx','w');z.writestr('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');z.writestr('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Office conversion works</w:t></w:r></w:p><w:sectPr/></w:body></w:document>');z.close()`,
]);
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      "C:/Users/lil_c/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe",
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const credentialPath = path.join(
      __dirname,
      "../test-results/shared-browser-owner.json",
    );
    let formatsResponse = await context.request.get(
      `${base}/api/conversion/formats`,
    );
    if (formatsResponse.status() === 401 && fs.existsSync(credentialPath)) {
      const credentials = JSON.parse(fs.readFileSync(credentialPath, "utf8"));
      const auth = await context.request.post(`${base}/api/auth/login`, {
        data: credentials,
      });
      assert.equal(auth.status(), 200, "Test owner login");
      formatsResponse = await context.request.get(
        `${base}/api/conversion/formats`,
      );
    }
    assert.equal(formatsResponse.status(), 200);
    const formats = await formatsResponse.json();
    assert.ok(
      formats.formats.some(
        (format) =>
          format.available &&
          format.extensions.some(
            (extension) => extension.replace(/^\./, "") === "png",
          ),
      ),
    );
    await page.goto(base);
    await page
      .getByRole("button", { name: "Convert files to PDF", exact: true })
      .click();
    const input = page.getByLabel("Files to convert");
    await input.setInputFiles(
      ["picture.png", "notes.txt", "unsupported.bad"].map((name) =>
        path.join(fixtureDir, name),
      ),
    );
    await page
      .getByRole("button", { name: "Remove unsupported.bad", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Move notes.txt up", exact: true })
      .click();
    assert.deepEqual(
      await page
        .locator(".conversion-queue li")
        .evaluateAll((elements) =>
          elements.map((element) => element.dataset.fileName),
        ),
      ["notes.txt", "picture.png"],
    );
    await page.getByLabel("One combined PDF, in this order").check();
    const combinedResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/convert") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Create combined PDF", exact: true })
      .click();
    const combined = await (await combinedResponse).json();
    assert.equal(combined.documents.length, 1);
    assert.equal(combined.documents[0].pageCount, 2);
    const combinedId = combined.documents[0].id;
    const firstPage = await (
      await context.request.get(
        `${base}/api/documents/${combinedId}/pages/0/text`,
      )
    ).json();
    assert.match(firstPage.text, /Conversion heading/);
    const secondPage = await (
      await context.request.get(
        `${base}/api/documents/${combinedId}/pages/1/text`,
      )
    ).json();
    assert.equal(secondPage.text.trim(), "");
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("link", { name: /^Download / }).click();
    const download = await downloadEvent;
    assert.ok(
      fs
        .readFileSync(await download.path())
        .subarray(0, 5)
        .toString() === "%PDF-",
    );
    await page.getByRole("button", { name: "Clear list", exact: true }).click();
    await input.setInputFiles(
      ["notes.txt", "unsupported.bad"].map((name) =>
        path.join(fixtureDir, name),
      ),
    );
    await page.getByLabel("A PDF for each file").check();
    const partialResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/convert") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Convert files", exact: true })
      .click();
    const partial = await (await partialResponse).json();
    assert.equal(partial.documents.length, 1);
    assert.equal(
      partial.results.filter((result) => result.status === "error").length,
      1,
    );
    await page
      .locator(".conversion-results .conversion-error")
      .filter({ hasText: "unsupported.bad" })
      .waitFor();
    await page
      .locator(".conversion-output")
      .getByRole("button", { name: "Open PDF", exact: true })
      .click();
    await page
      .locator(".pdf-text-layer")
      .getByText("Conversion heading", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page.getByRole("button", { name: /Convert to PDF Images/ }).click();
    if (formats.officeAvailable) {
      await page
        .getByLabel("Files to convert")
        .setInputFiles(path.join(fixtureDir, "letter.docx"));
      const officeResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/convert") &&
          response.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Convert files", exact: true })
        .click();
      const office = await (await officeResponse).json();
      assert.equal(office.documents.length, 1, JSON.stringify(office.results));
      const text = await (
        await context.request.get(
          `${base}/api/documents/${office.documents[0].id}/pages/0/text`,
        )
      ).json();
      assert.match(text.text, /Office conversion works/);
    } else {
      await page.getByText("Other formats", { exact: true }).click();
      await page
        .getByText(/requires LibreOffice/)
        .first()
        .waitFor();
    }
    await page.evaluate(
      () => (document.documentElement.dataset.theme = "dark"),
    );
    await page.screenshot({
      path: path.join(__dirname, "conversion-dark.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page
        .locator(".conversion-dialog")
        .evaluate((element) => element.scrollWidth > element.clientWidth + 1),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      `PASS: conversion without PDF, ordered image/text combine, queue remove/reorder, PDF download/open, partial failure, Tools entry, dark/mobile; Office ${formats.officeAvailable ? "converted DOCX" : "availability accurately unavailable"}`,
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
