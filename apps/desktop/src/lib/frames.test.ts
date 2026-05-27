import { describe, expect, test } from "vitest";
import type { LatestFrame, LatestFrameDto } from "../types";
import {
  compareFrames,
  formatCanId,
  formatPayloadHex,
  formatServerStartedAt,
  mapSnapshotFrame,
  mergeFramesById,
  rateBarWidthPercent,
  sumNumericStrings,
} from "./frames";

function frame(patch: Partial<LatestFrame>): LatestFrame {
  return {
    rowKey: "CAN0-standard-classic-data-0x100",
    bus: "CAN0",
    id: "0x100",
    idFormat: "standard",
    frameFormat: "classic",
    frameType: "data",
    dlc: 8,
    length: 8,
    data: "00 00 00 00 00 00 00 00",
    flags: "",
    lastSeen: "1.000",
    rateHz: "10.0",
    count: 1,
    raw: "",
    ...patch,
  };
}

describe("formatCanId", () => {
  test("formats standard and extended IDs with stable padding", () => {
    expect(formatCanId("0x2a", "standard")).toBe("0x02A");
    expect(formatCanId("1abcdef", "extended")).toBe("0x01ABCDEF");
  });
});

describe("formatPayloadHex", () => {
  test("formats compact payload hex as byte groups", () => {
    expect(formatPayloadHex("00010A10")).toBe("00 01 0A 10");
    expect(formatPayloadHex("")).toBe("");
  });
});

describe("mapSnapshotFrame", () => {
  test("maps server DTO to latest frame view model", () => {
    const dto: LatestFrameDto = {
      bus: "CAN1",
      id: "0x2a",
      id_format: "standard",
      frame_format: "classic",
      frame_type: "data",
      dlc: 2,
      length: 2,
      data: "AABB",
      flags: "",
      last_seen: "123.456",
      rate_hz: "8.5",
      count: 3,
      raw: "raw-line",
    };

    expect(mapSnapshotFrame(dto)).toMatchObject({
      rowKey: "CAN1-standard-classic-data-0x02A",
      id: "0x02A",
      data: "AA BB",
      rateHz: "8.5",
      count: 3,
    });
  });
});

describe("compareFrames", () => {
  test("sorts by bus, ID, and recent timestamp", () => {
    const can0_200 = frame({ bus: "CAN0", id: "0x200", lastSeen: "1.000" });
    const can1_100 = frame({ bus: "CAN1", id: "0x100", lastSeen: "3.000" });
    const can0_100 = frame({ bus: "CAN0", id: "0x100", lastSeen: "2.000" });

    expect([can1_100, can0_200, can0_100].sort((a, b) => compareFrames(a, b, "bus"))).toEqual([
      can0_100,
      can0_200,
      can1_100,
    ]);
    expect([can1_100, can0_200, can0_100].sort((a, b) => compareFrames(a, b, "id"))).toEqual([
      can0_100,
      can1_100,
      can0_200,
    ]);
    expect([can0_200, can0_100, can1_100].sort((a, b) => compareFrames(a, b, "recent"))).toEqual([
      can1_100,
      can0_100,
      can0_200,
    ]);
  });
});

describe("mergeFramesById", () => {
  test("merges matching IDs across buses and preserves detail rows", () => {
    const merged = mergeFramesById([
      frame({ bus: "CAN1", id: "0x200", count: 2, rateHz: "5.5", lastSeen: "1.000" }),
      frame({ bus: "CAN0", id: "0x200", count: 3, rateHz: "4.5", lastSeen: "2.000" }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      bus: "ALL",
      id: "0x200",
      count: 5,
      rateHz: "10.0",
      lastSeen: "2.000",
    });
    expect(merged[0].mergedDetails?.map((detail) => detail.bus)).toEqual(["CAN0", "CAN1"]);
  });
});

describe("numeric helpers", () => {
  test("sums numeric strings and handles empty values", () => {
    expect(sumNumericStrings("1.2", "3.4")).toBe("4.6");
    expect(sumNumericStrings("-", "-")).toBe("-");
  });

  test("formats invalid server start time as a dash", () => {
    expect(formatServerStartedAt("-")).toBe("-");
  });

  test("computes bounded rate bar width", () => {
    expect(rateBarWidthPercent("25", 100)).toBe(25);
    expect(rateBarWidthPercent("250", 100)).toBe(100);
    expect(rateBarWidthPercent("-", 100)).toBe(0);
  });
});
