import { useRef } from "react";
type Props = { onChange: (content: string) => void };
export default function SignaturePad({ onChange }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return [
      ((event.clientX - bounds.left) * event.currentTarget.width) /
        bounds.width,
      ((event.clientY - bounds.top) * event.currentTarget.height) /
        bounds.height,
    ];
  }
  return (
    <div className="signature-pad">
      <canvas
        ref={canvas}
        width={800}
        height={250}
        aria-label="Draw your signature"
        onPointerDown={(event) => {
          const context = event.currentTarget.getContext("2d");
          if (!context) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drawing.current = true;
          const [x, y] = point(event);
          context.strokeStyle = "#22252b";
          context.lineWidth = 3;
          context.lineCap = "round";
          context.lineJoin = "round";
          context.beginPath();
          context.moveTo(x, y);
          context.lineTo(x + 0.1, y);
          context.stroke();
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          const [x, y] = point(event);
          const context = event.currentTarget.getContext("2d");
          context?.lineTo(x, y);
          context?.stroke();
        }}
        onPointerUp={(event) => {
          drawing.current = false;
          onChange(event.currentTarget.toDataURL("image/png").split(",")[1]);
        }}
        onPointerCancel={() => {
          drawing.current = false;
        }}
      />
      <button
        onClick={() => {
          canvas.current?.getContext("2d")?.clearRect(0, 0, 800, 250);
          onChange("");
        }}
      >
        Clear
      </button>
    </div>
  );
}
