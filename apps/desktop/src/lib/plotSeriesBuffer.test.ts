import { describe, expect, test } from "vitest";
import type { PlotPointDto, PlotSeries } from "../types";
import {
  appendPlotPointsToBuffers,
  countBufferedPointsInWindow,
  createPlotSeriesBuffers,
  forEachPlotBufferBucket,
  getCurrentPlotValuesFromBuffers,
} from "./plotSeriesBuffer";

function series(id: string): PlotSeries {
  return {
    id,
    panelId: "panel",
    panelTitle: "Panel",
    signalId: id,
    label: id,
    axis: "left",
    scale: 1,
    offset: 0,
    unit: "V",
    color: "#0066cc",
  };
}

function point(seriesId: string, timestamp: string, value: number): PlotPointDto {
  return {
    panel_id: "panel",
    series_id: seriesId,
    source_signal_id: seriesId,
    name: seriesId,
    timestamp_host: timestamp,
    value,
    unit: "V",
    quality: "ok",
    source_sequence: Number.parseFloat(timestamp) || 0,
  };
}

describe("plot series buffers", () => {
  test("aggregates points into fixed 60 Hz buckets in chronological order", () => {
    const buffers = createPlotSeriesBuffers([series("a")], 3);
    appendPlotPointsToBuffers(buffers, [
      point("a", "1.000", 1),
      point("a", "1.001", 3),
      point("a", "1.020", 5),
      point("a", "1.040", 7),
    ]);

    const buckets: Array<{ min: number; max: number; avg: number; count: number }> = [];
    forEachPlotBufferBucket(buffers.get("a")!, (_timestamp, min, max, avg, count) => {
      buckets.push({ min, max, avg, count });
    });

    expect(buckets).toEqual([
      { min: 1, max: 3, avg: 2, count: 2 },
      { min: 5, max: 5, avg: 5, count: 1 },
      { min: 7, max: 7, avg: 7, count: 1 },
    ]);
  });

  test("counts visible points and exposes the latest current value", () => {
    const seriesList = [series("a"), series("b")];
    const buffers = createPlotSeriesBuffers(seriesList, 10);
    appendPlotPointsToBuffers(buffers, [
      point("a", "1.000", 1),
      point("a", "9.000", 9),
      point("b", "10.000", 10),
      point("b", "12.000", 12),
    ]);

    expect(countBufferedPointsInWindow(buffers, ["a", "b"], 3)).toBe(3);
    expect(getCurrentPlotValuesFromBuffers(buffers, seriesList, ["b"])).toEqual([
      {
        series: seriesList[1],
        latestPoint: {
          timestamp_host: "12.000",
          value: 12,
          unit: "V",
        },
      },
    ]);
  });

  test("produces the same buckets when the same data arrives in different chunks", () => {
    const seriesList = [series("a")];
    const oneShot = createPlotSeriesBuffers(seriesList, 10);
    const chunked = createPlotSeriesBuffers(seriesList, 10);
    const points = [
      point("a", "1.000", 1),
      point("a", "1.002", 4),
      point("a", "1.018", 8),
      point("a", "1.019", 10),
      point("a", "1.034", 6),
    ];

    appendPlotPointsToBuffers(oneShot, points);
    appendPlotPointsToBuffers(chunked, points.slice(0, 2));
    appendPlotPointsToBuffers(chunked, points.slice(2));

    function snapshot(bufferId: "oneShot" | "chunked") {
      const buffers = bufferId === "oneShot" ? oneShot : chunked;
      const result: Array<{ start: number; min: number; max: number; avg: number; count: number }> = [];
      forEachPlotBufferBucket(buffers.get("a")!, (start, min, max, avg, count) => {
        result.push({ start, min, max, avg, count });
      });
      return result;
    }

    expect(snapshot("chunked")).toEqual(snapshot("oneShot"));
  });
});
