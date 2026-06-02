import type { PlotSeries } from "../types";

export const plotColorPalette = [
  "#4E98E2",
  "#F5774D",
  "#E3C84E",
  "#52C7A3",
  "#9B72E7",
  "#E2558B",
  "#58A55C",
  "#C47A2C",
  "#2F80ED",
  "#EB5757",
  "#F2994A",
  "#27AE60",
  "#56CCF2",
  "#BB6BD9",
  "#828282",
  "#111827",
];

export function autoAssignPlotSeriesColors(seriesList: PlotSeries[]) {
  return seriesList.map((series, index) => ({
    ...series,
    color: plotColorPalette.includes(series.color)
      ? series.color
      : plotColorPalette[index % plotColorPalette.length],
  }));
}
