import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  StandardFonts,
  degrees,
  rgb,
} from "pdf-lib";

export type Field = {
  name: string;
  kind: "text" | "check" | "choice";
  value: string | boolean;
  options?: string[];
  readonly: boolean;
};
export type Point = { x: number; y: number };
export const load = (bytes: Uint8Array) => PDFDocument.load(bytes);
export function parsePages(value: string, count: number): number[] {
  const result = new Set<number>();
  for (const part of value.split(",")) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match)
      throw new Error(
        "Enter page numbers or ranges, such as 1, 3–5 (use a hyphen).",
      );
    const start = Number(match[1]),
      end = Number(match[2] ?? start);
    if (start < 1 || end > count || end < start)
      throw new Error(
        `Pages must be between 1 and ${count}, in ascending ranges.`,
      );
    for (let i = start; i <= end; i++) result.add(i - 1);
  }
  return [...result];
}
export async function transform(
  bytes: Uint8Array,
  change: (doc: PDFDocument) => void | Promise<void>,
) {
  const doc = await load(bytes);
  await change(doc);
  return doc.save();
}
export async function pageAction(
  bytes: Uint8Array,
  index: number,
  action: "rotate" | "delete" | "duplicate" | "up" | "down",
) {
  return transform(bytes, async (doc) => {
    const count = doc.getPageCount();
    if (index < 0 || index >= count) throw new Error("Page not found.");
    if (action === "rotate")
      doc
        .getPage(index)
        .setRotation(
          degrees((doc.getPage(index).getRotation().angle + 90) % 360),
        );
    if (action === "delete") {
      if (count === 1)
        throw new Error("Keep at least one page in the document.");
      doc.removePage(index);
    }
    if (action === "duplicate") {
      const source = await load(bytes);
      source.getForm().flatten();
      const [copy] = await doc.copyPages(source, [index]);
      doc.insertPage(index + 1, copy);
    }
    if (action === "up" || action === "down") {
      const target = index + (action === "up" ? -1 : 1);
      if (target < 0 || target >= count) return;
      const page = doc.getPage(index);
      doc.removePage(index);
      doc.insertPage(target, page);
    }
  });
}
export async function extract(bytes: Uint8Array, indices: number[]) {
  const source = await load(bytes),
    output = await PDFDocument.create();
  // Copying form widgets without their AcroForm loses editable fields; flatten the copied source first.
  source.getForm().flatten();
  for (const page of await output.copyPages(source, indices))
    output.addPage(page);
  return output.save();
}
export async function merge(bytes: Uint8Array, incoming: Uint8Array[]) {
  return transform(bytes, async (doc) => {
    for (const data of incoming) {
      const source = await load(data);
      source.getForm().flatten();
      for (const page of await doc.copyPages(source, source.getPageIndices()))
        doc.addPage(page);
    }
  });
}
export async function fields(bytes: Uint8Array): Promise<Field[]> {
  return (await load(bytes))
    .getForm()
    .getFields()
    .flatMap<Field>((field) => {
      const base = { name: field.getName(), readonly: field.isReadOnly() };
      if (field instanceof PDFTextField)
        return [
          { ...base, kind: "text" as const, value: field.getText() ?? "" },
        ];
      if (field instanceof PDFCheckBox)
        return [{ ...base, kind: "check" as const, value: field.isChecked() }];
      if (field instanceof PDFDropdown || field instanceof PDFOptionList)
        return [
          {
            ...base,
            readonly: base.readonly || field.isMultiselect(),
            kind: "choice" as const,
            value: field.getSelected()[0] ?? "",
            options: field.getOptions(),
          },
        ];
      if (field instanceof PDFRadioGroup)
        return [
          {
            ...base,
            kind: "choice" as const,
            value: field.getSelected() ?? "",
            options: field.getOptions(),
          },
        ];
      return [];
    });
}
export async function fill(bytes: Uint8Array, values: Field[]) {
  return transform(bytes, (doc) => {
    for (const value of values.filter((v) => !v.readonly)) {
      const field = doc.getForm().getField(value.name);
      if (field instanceof PDFTextField) field.setText(String(value.value));
      if (field instanceof PDFCheckBox)
        value.value ? field.check() : field.uncheck();
      if (
        field instanceof PDFDropdown ||
        field instanceof PDFOptionList ||
        field instanceof PDFRadioGroup
      ) {
        if (value.value) field.select(String(value.value));
        else field.clear();
      }
    }
  });
}
const color = (hex: string) =>
  rgb(
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  );
export async function annotate(
  bytes: Uint8Array,
  pageIndex: number,
  kind: "text" | "ink" | "highlight",
  points: Point[],
  text: string,
  size: number,
  hex: string,
) {
  return transform(bytes, async (doc) => {
    const page = doc.getPage(pageIndex),
      start = points[0];
    if (kind === "text") {
      const font = await doc.embedFont(StandardFonts.Helvetica);
      page.drawText(text, { ...start, size, font, color: color(hex) });
    }
    if (kind === "ink")
      for (let i = 1; i < points.length; i++)
        page.drawLine({
          start: points[i - 1],
          end: points[i],
          thickness: size / 8,
          color: color(hex),
          opacity: 1,
        });
    if (kind === "highlight") {
      const end = points[points.length - 1];
      page.drawRectangle({
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width: Math.abs(start.x - end.x),
        height: Math.abs(start.y - end.y),
        color: color(hex),
        opacity: 0.3,
      });
    }
  });
}
export async function convert(file: File): Promise<Uint8Array> {
  const data = new Uint8Array(await file.arrayBuffer());
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
    await load(data);
    return data;
  }
  const doc = await PDFDocument.create();
  if (/\.(png|jpe?g|webp)$/i.test(file.name) || /^image\//.test(file.type)) {
    let png = data;
    if (!/\.png$/i.test(file.name) && file.type !== "image/png") {
      const bitmap = await createImageBitmap(file),
        canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
      bitmap.close();
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) =>
            b ? resolve(b) : reject(new Error("Could not convert this image.")),
          "image/png",
        ),
      );
      png = new Uint8Array(await blob.arrayBuffer());
    }
    const image = await doc.embedPng(png),
      scale = Math.min(1, 14400 / Math.max(image.width, image.height));
    const page = doc.addPage([image.width * scale, image.height * scale]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: page.getWidth(),
      height: page.getHeight(),
    });
  } else if (/\.txt$/i.test(file.name) || file.type === "text/plain") {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    let page = doc.addPage(),
      y = page.getHeight() - 50;
    const input = await file.text();
    for (const paragraph of input.replace(/\r/g, "").split("\n")) {
      let line = "";
      for (const char of paragraph.replace(/\t/g, "    ")) {
        if (font.widthOfTextAtSize(line + char, 11) > page.getWidth() - 100) {
          page.drawText(line, { x: 50, y, size: 11, font });
          y -= 16;
          line = "";
          if (y < 50) {
            page = doc.addPage();
            y = page.getHeight() - 50;
          }
        }
        line += char;
      }
      page.drawText(line, { x: 50, y, size: 11, font });
      y -= 16;
      if (y < 50) {
        page = doc.addPage();
        y = page.getHeight() - 50;
      }
    }
  } else
    throw new Error(
      "Open a PDF, PNG, JPEG, WebP or TXT file. Office conversion is available in the desktop app.",
    );
  return doc.save();
}
export function download(
  bytes: Uint8Array,
  name: string,
  type = "application/pdf",
) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
