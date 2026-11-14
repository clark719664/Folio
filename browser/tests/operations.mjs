import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  pageAction,
  parsePages,
  merge,
  extract,
  annotate,
  fill,
  fields,
  convert,
} from "../src/pdf.ts";
const source = await PDFDocument.create();
const font = await source.embedFont(StandardFonts.Helvetica);
for (let i = 0; i < 3; i++) {
  const p = source.addPage([400 + i * 10, 600]);
  p.drawText(`Page ${i + 1}`, { x: 40, y: 550, font });
}
const field = source.getForm().createTextField("Full name");
field.setText("Before");
field.addToPage(source.getPage(0), { x: 40, y: 400, width: 200, height: 25 });
const check = source.getForm().createCheckBox("Agree");
check.addToPage(source.getPage(0), { x: 40, y: 350, width: 15, height: 15 });
const bytes = await source.save();
assert.deepEqual(parsePages("1, 2-3, 1", 3), [0, 1, 2]);
for (const bad of ["0", "4", "3-1", "x", "1,"])
  assert.throws(() => parsePages(bad, 3));
const rotated = await PDFDocument.load(await pageAction(bytes, 0, "rotate"));
assert.equal(rotated.getPage(0).getRotation().angle, 90);
const moved = await PDFDocument.load(await pageAction(bytes, 0, "down"));
assert.equal(moved.getPage(0).getWidth(), 410);
assert.equal(moved.getPage(1).getWidth(), 400);
const duplicated = await PDFDocument.load(
  await pageAction(bytes, 1, "duplicate"),
);
assert.equal(duplicated.getPageCount(), 4);
assert.equal(duplicated.getPage(2).getWidth(), 410);
const removed = await PDFDocument.load(await pageAction(bytes, 1, "delete"));
assert.equal(removed.getPageCount(), 2);
assert.equal(removed.getPage(1).getWidth(), 420);
const extracted = await extract(bytes, [2, 0]);
const out = await PDFDocument.load(extracted);
assert.equal(out.getPageCount(), 2);
assert.equal(out.getPage(0).getWidth(), 420);
assert.equal(out.getForm().getFields().length, 0);
const merged = await PDFDocument.load(await merge(bytes, [extracted]));
assert.equal(merged.getPageCount(), 5);
assert.equal(merged.getForm().getTextField("Full name").getText(), "Before");
const values = await fields(bytes);
values.find((x) => x.name === "Full name").value = "After";
values.find((x) => x.name === "Agree").value = true;
const filled = await PDFDocument.load(await fill(bytes, values));
assert.equal(filled.getForm().getTextField("Full name").getText(), "After");
assert.equal(filled.getForm().getCheckBox("Agree").isChecked(), true);
let marked = await annotate(
  bytes,
  0,
  "text",
  [{ x: 20, y: 20 }],
  "Added text",
  16,
  "#222222",
);
marked = await annotate(
  marked,
  0,
  "ink",
  [
    { x: 30, y: 30 },
    { x: 40, y: 40 },
  ],
  "",
  16,
  "#222222",
);
marked = await annotate(
  marked,
  0,
  "highlight",
  [
    { x: 50, y: 50 },
    { x: 100, y: 80 },
  ],
  "",
  16,
  "#ffcc00",
);
assert.equal((await PDFDocument.load(marked)).getPageCount(), 3);
const txt = await convert(
  new File(["A long line ".repeat(300)], "notes.txt", { type: "text/plain" }),
);
assert.ok((await PDFDocument.load(txt)).getPageCount() >= 1);
const single = await extract(bytes, [0]);
await assert.rejects(() => pageAction(single, 0, "delete"), /at least one/);
await assert.rejects(
  () => convert(new File(["bad"], "wrong.docx")),
  /Office conversion/,
);
console.log(
  "PASS: range validation, rotation, page order, duplicate/delete, form-preserving merge, flattened extraction, text/ink/highlight, form filling, TXT conversion, single-page protection.",
);
