import React from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { PlotPointDto, PlotSeries } from "../types";

type UPlotLiveChartProps = {
  plotSeries: PlotSeries[];
  visibleSeriesIds: string[];
  points: PlotPointDto[];
  dataVersion: number;
  showLegend: boolean;
  onFrameMeasured: (durationMs: number) => void;
};

function emptyAlignedData(seriesCount: number): uPlot.AlignedData {
  return Array.from({ length: seriesCount + 1 }, () => [] as number[]) as unknown as uPlot.AlignedData;
}

function buildAlignedData(
  points: PlotPointDto[],
  seriesList: PlotSeries[],
): uPlot.AlignedData {
  if (points.length === 0 || seriesList.length === 0) {
    return emptyAlignedData(seriesList.length);
  }

  const timestamps = Array.from(
    new Set(
      points
        .map((point) => Number.parseFloat(point.timestamp_host))
        .filter(Number.isFinite),
    ),
  ).sort((left, right) => left - right);
  const timestampIndex = new Map(timestamps.map((timestamp, index) => [timestamp, index]));
  const values = seriesList.map(() => Array<number | null>(timestamps.length).fill(null));
  const seriesIndex = new Map(seriesList.map((series, index) => [series.id, index]));

  for (const point of points) {
    const x = Number.parseFloat(point.timestamp_host);
    const xIndex = timestampIndex.get(x);
    const yIndex = seriesIndex.get(point.series_id);
    if (xIndex === undefined || yIndex === undefined) {
      continue;
    }
    values[yIndex][xIndex] = point.value;
  }

  return [timestamps, ...values] as uPlot.AlignedData;
}

export function UPlotLiveChart({
  plotSeries,
  visibleSeriesIds,
  points,
  dataVersion,
  showLegend,
  onFrameMeasured,
}: UPlotLiveChartProps) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const chartRef = React.useRef<uPlot | null>(null);
  const visibleSeries = React.useMemo(
    () => plotSeries.filter((series) => visibleSeriesIds.includes(series.id)),
    [plotSeries, visibleSeriesIds],
  );
  const visiblePointCount = React.useMemo(() => {
    const visible = new Set(visibleSeries.map((series) => series.id));
    return points.filter((point) => visible.has(point.series_id)).length;
  }, [points, visibleSeries]);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }

    const makeOptions = (): uPlot.Options => ({
      width: Math.max(320, host.clientWidth),
      height: Math.max(240, host.clientHeight),
      legend: { show: showLegend },
      cursor: { drag: { x: true, y: true } },
      scales: { x: { time: false } },
      axes: [
        {
          stroke: "#66747A",
          grid: { stroke: "#D8E0E3", width: 1 },
        },
        {
          stroke: "#66747A",
          grid: { stroke: "#D8E0E3", width: 1 },
        },
      ],
      series: [
        {},
        ...visibleSeries.map((series) => ({
          label: series.label,
          stroke: series.color,
          width: 1.5,
          points: { show: false },
        })),
      ],
    });

    chartRef.current = new uPlot(makeOptions(), emptyAlignedData(visibleSeries.length), host);
    const resizeObserver = new ResizeObserver(() => {
      const chart = chartRef.current;
      if (!chart || !host.clientWidth || !host.clientHeight) {
        return;
      }
      chart.setSize({
        width: Math.max(320, host.clientWidth),
        height: Math.max(240, host.clientHeight),
      });
    });
    resizeObserver.observe(host);

    return () => {
      resizeObserver.disconnect();
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [showLegend, visibleSeries]);

  React.useEffect(() => {
    const chart = chartRef.current;
    if (!chart) {
      return;
    }
    const startedAt = performance.now();
    const data = buildAlignedData(points, visibleSeries);
    chart.setData(data);
    requestAnimationFrame(() => {
      onFrameMeasured(performance.now() - startedAt);
    });
  }, [dataVersion, onFrameMeasured, points, visibleSeries]);

  return (
    <div
      className="uplot-live-chart"
      ref={hostRef}
      aria-label="live plot"
      data-point-count={visiblePointCount}
      data-series-count={visibleSeries.length}
      data-series-ids={visibleSeries.map((series) => series.id).join(",")}
    />
  );
}
