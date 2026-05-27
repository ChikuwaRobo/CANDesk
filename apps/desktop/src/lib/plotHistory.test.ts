import { describe, expect, test } from "vitest";
import type { PlotPointDto, SignalSampleDto } from "../types";
import {
  appendUniquePlotPoints,
  appendUniqueSamples,
  filterRecentPlotPoints,
  plotPointKey,
  resetSeenPlotPointKeys,
  resetSeenSampleKeys,
  signalSampleKey,
} from "./plotHistory";

function sample(patch: Partial<SignalSampleDto>): SignalSampleDto {
  return {
    timestamp_host: "1.000",
    bus: "CAN0",
    frame_id: "0x100",
    signal_id: "rpm",
    name: "RPM",
    value: 1,
    unit: "rpm",
    quality: "ok",
    source_sequence: 1,
    ...patch,
  };
}

function point(patch: Partial<PlotPointDto>): PlotPointDto {
  return {
    timestamp_host: "1.000",
    panel_id: "motor",
    series_id: "rpm",
    source_signal_id: "rpm",
    name: "RPM",
    value: 1,
    unit: "rpm",
    quality: "ok",
    source_sequence: 1,
    ...patch,
  };
}

describe("history keys", () => {
  test("builds stable sample and plot point keys", () => {
    expect(signalSampleKey(sample({}))).toBe("rpm-1-1.000");
    expect(plotPointKey(point({}))).toBe("motor-rpm-1-1.000");
  });
});

describe("appendUniqueSamples", () => {
  test("appends unseen samples and trims to max length", () => {
    const seen = new Set<string>();
    const first = sample({ source_sequence: 1, timestamp_host: "1.000" });
    const duplicate = sample({ source_sequence: 1, timestamp_host: "1.000" });
    const second = sample({ source_sequence: 2, timestamp_host: "2.000" });
    resetSeenSampleKeys([first], seen);

    expect(appendUniqueSamples([first], [duplicate, second], seen, 1)).toEqual([second]);
    expect([...seen]).toEqual([signalSampleKey(second)]);
  });
});

describe("appendUniquePlotPoints", () => {
  test("appends unseen points and trims to max length", () => {
    const seen = new Set<string>();
    const first = point({ source_sequence: 1, timestamp_host: "1.000" });
    const duplicate = point({ source_sequence: 1, timestamp_host: "1.000" });
    const second = point({ source_sequence: 2, timestamp_host: "2.000" });
    resetSeenPlotPointKeys([first], seen);

    expect(appendUniquePlotPoints([first], [duplicate, second], seen, 1)).toEqual([second]);
    expect([...seen]).toEqual([plotPointKey(second)]);
  });
});

describe("filterRecentPlotPoints", () => {
  test("keeps points inside the latest timestamp window", () => {
    const points = [
      point({ timestamp_host: "1.000", source_sequence: 1 }),
      point({ timestamp_host: "5.000", source_sequence: 2 }),
      point({ timestamp_host: "12.000", source_sequence: 3 }),
    ];

    expect(filterRecentPlotPoints(points, 10).map((entry) => entry.timestamp_host)).toEqual([
      "5.000",
      "12.000",
    ]);
  });

  test("returns original points when timestamps are not numeric", () => {
    const points = [point({ timestamp_host: "not-a-time" })];
    expect(filterRecentPlotPoints(points, 10)).toBe(points);
  });
});
