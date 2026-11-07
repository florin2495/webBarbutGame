import { ImageResponse } from "next/og";

// Opaque icon: two dice on a black background. Shapes only, no fonts.
const PIPS: Record<number, [number, number][]> = {
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

function Die({ size, value, rotate, x, y }: { size: number; value: 5 | 6; rotate: number; x: number; y: number }) {
  const pad = size * 0.16;
  const cell = (size - pad * 2) / 3;
  const pip = cell * 0.62;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: size,
        height: size,
        background: "#fafafa",
        borderRadius: size * 0.2,
        transform: `rotate(${rotate}deg)`,
        display: "flex",
      }}
    >
      {PIPS[value].map(([c, r], i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: pad + c * cell + (cell - pip) / 2,
            top: pad + r * cell + (cell - pip) / 2,
            width: pip,
            height: pip,
            borderRadius: pip,
            background: "#7f1d1d",
          }}
        />
      ))}
    </div>
  );
}

/** `safe` = fraction of the canvas the artwork may use (centred). */
export function renderPwaIcon(px: number, safe: number): ImageResponse {
  const area = px * safe;
  const off = (px - area) / 2;
  const die = area * 0.5;
  return new ImageResponse(
    (
      <div style={{ width: px, height: px, background: "#18181b", display: "flex", position: "relative" }}>
        <Die size={die} value={6} rotate={-12} x={off + area * 0.04} y={off + area * 0.1} />
        <Die size={die} value={5} rotate={10} x={off + area * 0.46} y={off + area * 0.4} />
      </div>
    ),
    { width: px, height: px },
  );
}
