import { renderPwaIcon } from "@/lib/pwa-icon";

const VARIANTS: Record<string, { px: number; safe: number }> = {
  // apple-touch-icon (linked from layout metadata: Turbopack does not basePath-prefix apple-icon.tsx).
  apple: { px: 180, safe: 0.9 },
  "192": { px: 192, safe: 0.9 },
  "512": { px: 512, safe: 0.9 },
  "512-maskable": { px: 512, safe: 0.72 },
};

export function generateStaticParams() {
  return Object.keys(VARIANTS).map((variant) => ({ variant }));
}

export async function GET(_req: Request, ctx: { params: Promise<{ variant: string }> }) {
  const { variant } = await ctx.params;
  const v = VARIANTS[variant];
  if (!v) return new Response("Not found", { status: 404 });
  return renderPwaIcon(v.px, v.safe);
}
