import React from "react";
import { makeDummyFrames } from "../fixtures/orionDummy";
import type { BusConfig, LatestFrame } from "../types";

type UseDummyFramesInput = {
  enabled: boolean;
  paused: boolean;
  setConnected: React.Dispatch<React.SetStateAction<boolean>>;
  setBuses: React.Dispatch<React.SetStateAction<BusConfig[]>>;
  setFrames: React.Dispatch<React.SetStateAction<LatestFrame[]>>;
  setEventLog: React.Dispatch<React.SetStateAction<string>>;
};

export function useDummyFrames({
  enabled,
  paused,
  setConnected,
  setBuses,
  setFrames,
  setEventLog,
}: UseDummyFramesInput) {
  React.useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let tick = 1;
    const timer = window.setInterval(() => {
      const nextFrames = makeDummyFrames(tick);
      setConnected(true);
      setBuses((current) =>
        current.map((bus, index) => ({
          ...bus,
          status: "connected",
          frames: tick * (index === 0 ? 390 : 315),
          errors: 0,
          rateHz: index === 0 ? "3900.0" : "3150.0",
          utilizationPercent: index === 0 ? "58.4" : "47.1",
          saturatedLast1sMs: index === 0 ? "0.0" : "0.0",
          saturatedWorst1sMs: index === 0 ? "8.2" : "3.6",
        })),
      );
      if (!paused) {
        setFrames(nextFrames);
      }
      setEventLog("dummy data mode; adapter input is bypassed");
      tick += 1;
    }, 100);

    return () => window.clearInterval(timer);
  }, [enabled, paused, setBuses, setConnected, setEventLog, setFrames]);
}
