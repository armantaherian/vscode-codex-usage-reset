import type { UsageHistory } from "./types";

export type TileTheme = "light" | "dark";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CELL = 11;
const GAP = 3;
const STEP = CELL + GAP;
const LABEL_WIDTH = 34;
const PAD = 8;

const PALETTE: Record<TileTheme, { empty: string; levels: string[]; text: string }> = {
  light: {
    empty: "#ebedf0",
    levels: ["#9be9a8", "#40c463", "#30a14e", "#216e39"],
    text: "#656d76",
  },
  dark: {
    empty: "#161b22",
    levels: ["#0e4429", "#006d32", "#26a641", "#39d353"],
    text: "#8b949e",
  },
};

export function tileLevel(value: number, max: number): number {
  if (value <= 0 || max <= 0) {
    return 0;
  }
  const ratio = value / max;
  if (ratio <= 0.25) {
    return 1;
  }
  if (ratio <= 0.5) {
    return 2;
  }
  if (ratio <= 0.75) {
    return 3;
  }
  return 4;
}

export function formatUsageCharts(history: UsageHistory, theme: TileTheme = "dark"): string {
  const { svg, width, height } = renderUsageSvg(history, theme);
  const uri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const peak = peakCell(history);
  const alt = `Usage tiles for the last 7 days. Busiest is ${WEEKDAYS[peak.day]} ${hourLabel(peak.hour).trim()}.`;
  return [
    "**Last 7 days**",
    "",
    `<img alt="${alt}" width="${width}" height="${height}" src="${uri}">`,
    "",
    "Each square is one hour on that weekday. Darker green means more usage.",
  ].join("\n");
}

export function renderUsageSvg(history: UsageHistory, theme: TileTheme): { svg: string; width: number; height: number } {
  const palette = PALETTE[theme];
  const max = Math.max(...history.cells.flat(), 0);
  const metrics = chartMetrics();
  const { originX, originY, width, legendY, height } = metrics;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  ];

  for (const hour of [0, 3, 6, 9, 12, 15, 18, 21]) {
    const x = originX + hour * STEP + CELL / 2;
    parts.push(`<text x="${x}" y="${PAD + 11}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="${palette.text}">${hourLabel(hour).trim()}</text>`);
  }

  history.cells.forEach((row, day) => {
    const y = originY + day * STEP;
    parts.push(`<text x="${PAD}" y="${y + 9}" font-family="sans-serif" font-size="10" fill="${palette.text}">${WEEKDAYS[day]}</text>`);
    row.forEach((value, hour) => {
      const level = tileLevel(value, max);
      const fill = level === 0 ? palette.empty : palette.levels[level - 1];
      const x = originX + hour * STEP;
      parts.push(`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${fill}"/>`);
    });
  });

  const legendWidth = 5 * STEP - GAP;
  const legendX = width - PAD - legendWidth - 36;
  parts.push(`<text x="${legendX - 8}" y="${legendY + 9}" text-anchor="end" font-family="sans-serif" font-size="10" fill="${palette.text}">Less</text>`);
  for (let level = 0; level < 5; level++) {
    const fill = level === 0 ? palette.empty : palette.levels[level - 1];
    parts.push(`<rect x="${legendX + level * STEP}" y="${legendY}" width="${CELL}" height="${CELL}" rx="2" fill="${fill}"/>`);
  }
  parts.push(`<text x="${legendX + legendWidth + 8}" y="${legendY + 9}" font-family="sans-serif" font-size="10" fill="${palette.text}">More</text>`);
  parts.push("</svg>");
  return { svg: parts.join(""), width, height };
}

function chartMetrics(): { originX: number; originY: number; width: number; legendY: number; height: number } {
  const originX = PAD + LABEL_WIDTH;
  const originY = PAD + 18;
  const gridWidth = 24 * STEP - GAP;
  const gridHeight = 7 * STEP - GAP;
  const width = originX + gridWidth + PAD;
  const legendY = originY + gridHeight + 16;
  const height = legendY + CELL + PAD;
  return { originX, originY, width, legendY, height };
}

function peakCell(history: UsageHistory): { day: number; hour: number } {
  let day = 0;
  let hour = 0;
  let best = -1;
  history.cells.forEach((row, dayIndex) => {
    row.forEach((value, hourIndex) => {
      if (value > best) {
        best = value;
        day = dayIndex;
        hour = hourIndex;
      }
    });
  });
  return { day, hour };
}

function hourLabel(hour: number): string {
  const onClock = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(onClock).padStart(2, " ")}${hour < 12 ? "a" : "p"}`;
}
