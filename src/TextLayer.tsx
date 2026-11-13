import { useMemo } from "react";
type Span = {
  text: string;
  bbox: number[];
  size: number;
  font: string;
  block?: number;
  line?: number;
};
type Props = {
  spans: Span[];
  page: { width: number; height: number; rotation: number };
  zoom: number;
};
export default function TextLayer({ spans, page, zoom }: Props) {
  const widths = useMemo(() => {
    const context = document.createElement("canvas").getContext("2d")!;
    return spans.map((span) => {
      context.font = `${span.size}px Arial`;
      return context.measureText(span.text).width || 1;
    });
  }, [spans]);
  const rotation = ((page.rotation % 360) + 360) % 360;
  const transform =
    rotation === 90
      ? `translateX(${page.height * zoom}px) rotate(90deg)`
      : rotation === 180
        ? `translate(${page.width * zoom}px, ${page.height * zoom}px) rotate(180deg)`
        : rotation === 270
          ? `translateY(${page.width * zoom}px) rotate(270deg)`
          : undefined;
  return (
    <div
      className="pdf-text-layer"
      aria-label="Document text"
      style={{
        width: page.width * zoom,
        height: page.height * zoom,
        transform,
      }}
      onCopy={(event) => {
        const selection = window.getSelection();
        if (!selection?.rangeCount || selection.isCollapsed) return;
        const range = selection.getRangeAt(0);
        const entries: { index: number; text: string }[] = [];
        for (const el of event.currentTarget.querySelectorAll<HTMLElement>(
          "[data-span]",
        )) {
          const node = el.firstChild;
          if (!node || !range.intersectsNode(node)) continue;
          const from = range.startContainer === node ? range.startOffset : 0;
          const to =
            range.endContainer === node
              ? range.endOffset
              : node.textContent!.length;
          const text = node.textContent!.slice(from, to);
          if (text) entries.push({ index: Number(el.dataset.span), text });
        }
        if (!entries.length) return;
        let text = entries[0].text;
        for (let i = 1; i < entries.length; i++) {
          const previous = spans[entries[i - 1].index],
            current = spans[entries[i].index];
          const newBlock =
            current.block !== undefined && previous.block !== current.block;
          const newLine =
            current.line !== undefined
              ? previous.line !== current.line
              : Math.abs(current.bbox[1] - previous.bbox[1]) >
                current.size * 0.5;
          const separator = newBlock
            ? "\n\n"
            : newLine
              ? "\n"
              : /\s$/.test(entries[i - 1].text) || /^\s/.test(entries[i].text)
                ? ""
                : current.bbox[0] > previous.bbox[2] + current.size * 0.15
                  ? " "
                  : "";
          text += separator + entries[i].text;
        }
        event.preventDefault();
        event.clipboardData.setData("text/plain", text);
      }}
    >
      {spans.map((span, index) => (
        <span
          key={index}
          data-span={index}
          style={{
            left: span.bbox[0] * zoom,
            top: span.bbox[1] * zoom,
            fontSize: span.size * zoom,
            lineHeight: `${(span.bbox[3] - span.bbox[1]) * zoom}px`,
            transform: `scaleX(${(span.bbox[2] - span.bbox[0]) / widths[index]})`,
          }}
        >
          {span.text}
        </span>
      ))}
    </div>
  );
}
