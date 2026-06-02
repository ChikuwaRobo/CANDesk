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
];

export function autoAssignPlotSeriesColors(seriesList: PlotSeries[]) {
  return seriesList.map((series, index) => ({
    ...series,
    color: plotColorPalette.includes(series.color)
      ? series.color
      : plotColorPalette[index % plotColorPalette.length],
  }));
}
