import { describe, expect, test } from "vitest";
import { makeDummyFrame, makeDummyFrames, makeOrionDummyPayload } from "./orionDummy";

describe("makeOrionDummyPayload", () => {
  test("generates 8-byte payloads for Orion preview IDs", () => {
    for (const id of [0x200, 0x215, 0x230, 0x241]) {
      expect(makeOrionDummyPayload(id, "CAN0", 1)).toMatch(/^[0-9A-F]{16}$/);
    }
  });

  test("uses a bus-specific phase offset", () => {
    expect(makeOrionDummyPayload(0x200, "CAN0", 3)).not.toBe(
      makeOrionDummyPayload(0x200, "CAN1", 3),
    );
  });
});

describe("makeDummyFrame", () => {
  test("builds a latest-frame view model for dummy monitor data", () => {
    const frame = makeDummyFrame("CAN0", 0x200, 0, 2);

    expect(frame).toMatchObject({
      bus: "CAN0",
      id: "0x200",
      frameFormat: "classic",
      dlc: 8,
      length: 8,
    });
    expect(frame.data.split(" ")).toHaveLength(8);
    expect(frame.raw).toContain("dummy:CAN0:0x200:");
  });
});

describe("makeDummyFrames", () => {
  test("generates two buses for each Orion preview ID", () => {
    const frames = makeDummyFrames(1);
    expect(frames).toHaveLength(8);
    expect(frames.filter((frame) => frame.bus === "CAN0")).toHaveLength(4);
    expect(frames.filter((frame) => frame.bus === "CAN1")).toHaveLength(4);
  });
});
