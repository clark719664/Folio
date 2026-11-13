const {
  chromium,
} = require("C:/Users/lil_c/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
execFileSync(path.join(root, "server/.venv/Scripts/python.exe"), [
  "-c",
  "import sys,base64,pathlib;sys.path.insert(0,r'" +
    path.join(root, "server") +
    "');from test_signatures import signing_material; data,archive,cert=signing_material.__wrapped__();p=pathlib.Path(r'" +
    __dirname +
    "');(p/'signing.pdf').write_bytes(data);(p/'test-signing.p12').write_bytes(base64.b64decode(archive));(p/'test-trust.pem').write_text(cert)",
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
    await page
      .getByRole("button", { name: "Open PDF", exact: true })
      .waitFor()
      .catch(async (error) => {
        console.error(
          "Startup errors",
          errors,
          "Page content",
          await page.locator("body").innerText(),
        );
        await browser.close();
        throw error;
      });
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles(path.join(__dirname, "signing.pdf"));
    await page
      .getByRole("button", { name: "Original content", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Find a tool" })
      .fill("certificate");
    await page
      .getByRole("button", { name: /Sign with a certificate Apply/ })
      .click();
    await page
      .getByLabel("Certificate file")
      .setInputFiles(path.join(__dirname, "test-signing.p12"));
    await page.getByLabel("Certificate password").fill("secret");
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Browser integration test");
    const signedEvent = page.waitForResponse(
      (response) =>
        response.url().endsWith("/signatures") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Sign document", exact: true })
      .click();
    const signedResponse = await signedEvent;
    assert.equal(signedResponse.status(), 200, await signedResponse.text());
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page.getByRole("textbox", { name: "Find a tool" }).fill("verify");
    await page
      .getByRole("button", { name: /Verify signatures Inspect/ })
      .click();
    await page
      .getByLabel("Trusted certificate")
      .setInputFiles(path.join(__dirname, "test-trust.pem"));
    const verifyEvent = page.waitForResponse((response) =>
      response.url().endsWith("/signatures/verify"),
    );
    await page
      .getByRole("button", { name: "Verify signatures", exact: true })
      .click();
    const verification = await (await verifyEvent).json();
    assert.equal(verification.signatures.length, 1);
    assert.equal(verification.signatures[0].valid, true);
    assert.equal(verification.signatures[0].intact, true);
    assert.equal(verification.signatures[0].trusted, true);
    await page.getByText("Trusted", { exact: true }).waitFor();
    await page.screenshot({
      path: path.join(__dirname, "signature-validation.png"),
    });
    assert.deepEqual(errors, []);
    console.log(
      "PASS certificate file/password UI, digital signature persistence, offline trusted validation and rendered result",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
