import { describe, expect, it } from "vitest";
import type { PlotPointDto } from "../types";
import {
  calculatePlotBounds,
  groupDrawablePointsBySeries,
  projectPlotPoints,
} from "./plotCanvas";

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

describe("groupDrawablePointsBySeries", () => {
  it("filters stale and non-finite points before grouping", () => {
    const grouped = groupDrawablePointsBySeries(
      [
        point("a", "89.9", 1),
        point("a", "90.0", 2),
        point("a", "100.0", Number.NaN),
        point("b", "bad", 3),
        point("b", "99.0", 4),
      ],
      10,
    );

    expect(grouped.get("a")).toEqual([point("a", "90.0", 2)]);
    expect(grouped.get("b")).toEqual([point("b", "99.0", 4)]);
  });
});

describe("calculatePlotBounds", () => {
  it("uses the visible window as the time domain", () => {
    const grouped = new Map([
      ["a", [point("a", "10.0", 10), point("a", "12.0", 14)]],
      ["b", [point("b", "11.0", -2)]],
    ]);

    expect(calculatePlotBounds(grouped, 5)).toEqual({
      minTime: 7,
      maxTime: 12,
      minValue: -2,
      maxValue: 14,
      timeRange: 5,
      valueRange: 16,
    });
  });

  it("returns null when there are no drawable points", () => {
    expect(calculatePlotBounds(new Map())).toBeNull();
  });
});

describe("projectPlotPoints", () => {
  it("projects points into canvas coordinates", () => {
    const bounds = {
      minTime: 0,
      maxTime: 10,
      minValue: 0,
      maxValue: 100,
      timeRange: 10,
      valueRange: 100,
    };
    const projected = projectPlotPoints(
      [point("a", "0", 0), point("a", "5", 50), point("a", "10", 100)],
      bounds,
      { left: 10, top: 20, width: 100, height: 50 },
    );

    expect(projected.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 10, y: 70 },
      { x: 60, y: 45 },
      { x: 110, y: 20 },
    ]);
  });

  it("limits dense series with a fixed stride", () => {
    const bounds = {
      minTime: 0,
      maxTime: 9,
      minValue: 0,
      maxValue: 9,
      timeRange: 9,
      valueRange: 9,
    };
    const projected = projectPlotPoints(
      Array.from({ length: 10 }, (_, index) => point("a", String(index), index)),
      bounds,
      { left: 0, top: 0, width: 90, height: 90 },
      4,
    );

    expect(projected.map(({ point }) => point.timestamp_host)).toEqual(["0", "3", "6", "9"]);
  });
});
