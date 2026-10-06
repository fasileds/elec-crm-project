"use client";

import { useRef, useState } from "react";

export function SignaturePad() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [data, setData] = useState("");

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * event.currentTarget.width, y: ((event.clientY - rect.top) / rect.height) * event.currentTarget.height };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = event.currentTarget.getContext("2d");
    if (!ctx) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const { x, y } = point(event);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#16181d";
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = event.currentTarget.getContext("2d");
    if (!ctx) return;
    const { x, y } = point(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function end() {
    if (!drawing.current || !canvas.current) return;
    drawing.current = false;
    setData(canvas.current.toDataURL("image/png"));
  }

  function clear() {
    const el = canvas.current;
    el?.getContext("2d")?.clearRect(0, 0, el.width, el.height);
    setData("");
  }

  return (
    <div className="sig-pad">
      <canvas ref={canvas} width={520} height={140} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} aria-label="Draw your signature (optional)" role="img" />
      <input type="hidden" name="drawing" value={data} />
      <div className="row">
        <span className="meta">Optional: draw your signature. Your typed name is always recorded.</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>Clear</button>
      </div>
    </div>
  );
}
