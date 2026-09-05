export type LineSeries = {
  label: string;
  color: string;
  values: readonly number[];
};

export type LineChartOptions = {
  title: string;
  description: string;
  firstLabel: string;
  lastLabel: string;
  series: readonly LineSeries[];
};

export function lineChartSvg(options: LineChartOptions): string {
  const width = 1280;
  const height = 640;
  const margin = { top: 82, right: 42, bottom: 74, left: 70 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const valueCount = Math.max(
    ...options.series.map((series) => series.values.length),
    0,
  );
  const maximum = Math.max(
    ...options.series.flatMap((series) => series.values),
    1,
  );
  const yMaximum = roundedMaximum(maximum);
  const ticks = 5;
  const paths = options.series
    .filter((series) => series.values.length > 0)
    .map(
      (series) =>
        `<path d="${linePath(series.values, chartWidth, chartHeight, yMaximum, margin)}" fill="none" stroke="${escapeXml(series.color)}" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"/>`,
    )
    .join("\n    ");
  const legend = options.series
    .map(
      (series, index) =>
        `<g transform="translate(${margin.left + index * 190} 46)"><line x2="26" stroke="${escapeXml(series.color)}" stroke-width="3"/><text x="34" y="5">${escapeXml(series.label)}</text></g>`,
    )
    .join("\n    ");
  const grid = Array.from({ length: ticks + 1 }, (_, index) => {
    const value = (yMaximum * index) / ticks;
    const y = margin.top + chartHeight - (chartHeight * index) / ticks;
    return `<g><line x1="${margin.left}" x2="${width - margin.right}" y1="${y}" y2="${y}"/><text x="${margin.left - 12}" y="${y + 5}" text-anchor="end">${formatValue(value)}</text></g>`;
  }).join("\n    ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(options.title)}</title>
  <desc id="desc">${escapeXml(options.description)}</desc>
  <style>
    text { fill: #253238; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 14px; }
    .title { font-size: 24px; font-weight: 700; }
    .axis { fill: #52656d; font-size: 13px; }
    .grid line { stroke: #d7e0e3; stroke-width: 1; }
  </style>
  <rect width="100%" height="100%" fill="#f9fbfb"/>
  <text class="title" x="${margin.left}" y="32">${escapeXml(options.title)}</text>
  <g class="legend">
    ${legend}
  </g>
  <g class="grid">
    ${grid}
  </g>
  <g class="axis">
    <text x="${margin.left}" y="${height - 28}">${escapeXml(options.firstLabel)}</text>
    <text x="${width - margin.right}" y="${height - 28}" text-anchor="end">${escapeXml(options.lastLabel)}</text>
    <text x="${margin.left}" y="${height - 10}">UTC calendar days</text>
    <text x="${width - margin.right}" y="${height - 10}" text-anchor="end">${valueCount} days</text>
  </g>
  <g>
    ${paths}
  </g>
</svg>
`;
}

function linePath(
  values: readonly number[],
  width: number,
  height: number,
  maximum: number,
  margin: { left: number; top: number },
): string {
  if (values.length === 1) {
    const y = margin.top + height - (values[0]! / maximum) * height;
    return `M ${margin.left} ${y} L ${margin.left + width} ${y}`;
  }

  return values
    .map((value, index) => {
      const x = margin.left + (index / (values.length - 1)) * width;
      const y = margin.top + height - (value / maximum) * height;
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

function roundedMaximum(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
