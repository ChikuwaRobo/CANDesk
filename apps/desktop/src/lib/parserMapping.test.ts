import { describe, expect, test } from "vitest";
import type { ParseConfigDto, PlotLayoutDto } from "../types";
import { mapParseConfig, mapPlotLayout, sampleSignalValue } from "./parserMapping";

describe("mapParseConfig", () => {
  test("maps parse config DTO to parser signal view model", () => {
    const config: ParseConfigDto = {
      version: 1,
      name: "sample",
      description: "",
      signals: [
        {
          id: "rpm",
          name: "RPM",
          selector: { bus: null, id: 0x2a },
          source: {
            data_type: "float32",
            byte_offset: 2,
            bit_offset: 0,
            bit_length: 32,
            endian: "little",
          },
          conversion: { scale: 2, offset: -1, unit: "rpm" },
        },
      ],
    };

    expect(mapParseConfig(config)).toEqual([
      {
        id: "rpm",
        name: "RPM",
        bus: "ALL",
        canId: "0x02A",
        dataType: "float32",
        byteOffset: 2,
        bitOffset: 0,
        bitLength: 32,
        endian: "little",
        signed: false,
        scale: 2,
        offset: -1,
        unit: "rpm",
      },
    ]);
  });

  test("infers signed integer signals", () => {
    const [signal] = mapParseConfig({
      version: 1,
      name: "sample",
      description: "",
      signals: [
        {
          id: "temp",
          name: "Temp",
          selector: { bus: "CAN1", id: 0x110 },
          source: {
            byte_offset: 0,
            bit_offset: 0,
            bit_length: 16,
            endian: "little",
            signed: true,
          },
          conversion: { scale: 0.1, offset: -40 },
        },
      ],
    });

    expect(signal.dataType).toBe("signed-int");
    expect(signal.signed).toBe(true);
    expect(signal.bus).toBe("CAN1");
    expect(signal.unit).toBe("");
  });
});

describe("mapPlotLayout", () => {
  test("flattens panels and series into plot series view models", () => {
    const layout: PlotLayoutDto = {
      version: 1,
      name: "layout",
      description: "",
      panels: [
        {
          id: "motor",
          title: "Motor",
          series: [
            {
              id: "rpm",
              signal_id: "rpm_signal",
              label: "RPM",
              color: "#123456",
              axis: "left",
              scale: 1,
              offset: 0,
              unit_override: null,
            },
          ],
        },
      ],
    };

    expect(mapPlotLayout(layout)).toEqual([
      {
        id: "rpm",
        panelId: "motor",
        panelTitle: "Motor",
        signalId: "rpm_signal",
        label: "RPM",
        axis: "left",
        scale: 1,
        offset: 0,
        unit: "",
        color: "#123456",
      },
    ]);
  });
});

describe("sampleSignalValue", () => {
  test("applies scale and offset to deterministic sample values", () => {
    expect(
      sampleSignalValue(
        {
          id: "sample",
          name: "Sample",
          bus: "ALL",
          canId: "0x100",
          dataType: "unsigned-int",
          byteOffset: 0,
          bitOffset: 0,
          bitLength: 16,
          endian: "little",
          signed: false,
          scale: 0.5,
          offset: 10,
          unit: "",
        },
        1,
      ),
    ).toBe(6675);
  });
});
