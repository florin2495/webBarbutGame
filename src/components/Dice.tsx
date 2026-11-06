"use client";

// Pip positions on a 3x3 grid (0..8, row-major) for each face.
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export function Die({
  value,
  size = "lg",
  rolling = false,
  tone = "plain",
}: {
  value: number | null;
  size?: "sm" | "lg";
  rolling?: boolean;
  tone?: "plain" | "win" | "lose";
}) {
  const box = size === "lg" ? "h-20 w-20 rounded-2xl p-2.5 gap-1" : "h-7 w-7 rounded-md p-1 gap-px";
  const pip = size === "lg" ? "h-3.5 w-3.5" : "h-1 w-1";
  const ring = {
    plain: "border-zinc-300 dark:border-zinc-600",
    win: "border-emerald-500 ring-2 ring-emerald-400/60",
    lose: "border-rose-500 ring-2 ring-rose-400/60",
  }[tone];
  const pips = value ? PIPS[value] : [];
  return (
    <span
      role="img"
      aria-label={value ? `zar ${value}` : "zar"}
      className={`grid shrink-0 grid-cols-3 grid-rows-3 border-2 bg-white shadow-sm dark:bg-zinc-100 ${box} ${ring} ${rolling ? "animate-[dice-roll_0.6s_ease-in-out]" : ""}`}
    >
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className="flex items-center justify-center">
          {pips.includes(i) && <span className={`${pip} rounded-full bg-zinc-900`} />}
        </span>
      ))}
    </span>
  );
}
