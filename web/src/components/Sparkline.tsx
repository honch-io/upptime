import { sparklinePaths } from "@/lib/status";

interface SparklineProps {
  values: Array<number | null | undefined>;
  color: string;
  label: string;
}

// Inline SVG sparkline. Renders nothing-but-a-hint when there are too few points.
export function Sparkline({ values, color, label }: SparklineProps) {
  const spark = sparklinePaths(values);
  if (!spark) {
    return (
      <p className="py-2 text-muted-foreground/80 text-xs">
        Collecting daily history — the trend appears once a few days of data accumulate.
      </p>
    );
  }
  return (
    <svg
      viewBox={spark.viewBox}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className="block h-14 w-full overflow-visible"
    >
      <path d={spark.area} fill={color} opacity={0.1} />
      <path
        d={spark.line}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
