import type { LatestFrame } from "../types";
import { formatCanId, formatPayloadHex } from "../lib/frames";

const dummyIds = [0x200, 0x215, 0x230, 0x241];

export function makeDummyFrame(
  bus: "CAN0" | "CAN1",
  id: number,
  index: number,
  tick: number,
): LatestFrame {
  const idText = formatCanId(`0x${id.toString(16)}`, "standard");
  const bytes = makeOrionDummyPayload(id, bus, tick);
  const rateHz = ((index + 1) * (bus === "CAN0" ? 12.5 : 9.5) + (tick % 5) * 2).toFixed(1);
  return {
    rowKey: `${bus}-standard-classic-data-${idText}`,
    bus,
    id: idText,
    idFormat: "standard",
    frameFormat: "classic",
    frameType: "data",
    dlc: 8,
    length: 8,
    data: formatPayloadHex(bytes),
    flags: "",
    lastSeen: `${Math.floor(Date.now() / 1000)}.${String(Date.now() % 1000).padStart(3, "0")}`,
    rateHz,
    count: tick * (index + 1) * (bus === "CAN0" ? 3 : 2),
    raw: `dummy:${bus}:${idText}:${bytes}`,
  };
}

export function makeDummyFrames(tick: number) {
  return dummyIds.flatMap((id, index) => [
    makeDummyFrame("CAN0", id, index, tick),
    makeDummyFrame("CAN1", id, index, tick),
  ]);
}

export function makeOrionDummyPayload(id: number, bus: "CAN0" | "CAN1", tick: number) {
  const busOffset = bus === "CAN1" ? 0.35 : 0;
  const phase = tick / 10 + busOffset;
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  if (id === 0x200) {
    view.setFloat32(0, 2.5 + Math.sin(phase) * 1.5, true);
    view.setFloat32(4, -(0.8 + Math.cos(phase) * 0.4), true);
  } else if (id === 0x215) {
    view.setFloat32(0, 24.0 + Math.sin(phase / 2) * 0.8, true);
  } else if (id === 0x230) {
    view.setFloat32(0, 3.0 + Math.cos(phase * 1.3) * 1.2, true);
  } else if (id === 0x241) {
    view.setInt16(0, Math.round(Math.sin(phase) * 120), true);
    view.setInt16(2, Math.round(Math.cos(phase) * 80), true);
    view.setUint16(4, 1000 + (tick % 300), true);
  }
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).toUpperCase().padStart(2, "0"),
  ).join("");
}
