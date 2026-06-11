import React from "react";
import type { CanRushClient } from "../api/types";
import { mapSnapshotFrame } from "../lib/frames";
import type { BusConfig, LatestFrame, ServerInfoDto } from "../types";

type UseSnapshotPollingInput = {
  client: CanRushClient;
  enabled: boolean;
  paused: boolean;
  serverConnected: boolean;
  setServerInfo: React.Dispatch<React.SetStateAction<ServerInfoDto>>;
  setConnected: React.Dispatch<React.SetStateAction<boolean>>;
  setBuses: React.Dispatch<React.SetStateAction<BusConfig[]>>;
  setFrames: React.Dispatch<React.SetStateAction<LatestFrame[]>>;
  setEventLog: React.Dispatch<React.SetStateAction<string>>;
};

export function useSnapshotPolling({
  client,
  enabled,
  paused,
  serverConnected,
  setServerInfo,
  setConnected,
  setBuses,
  setFrames,
  setEventLog,
}: UseSnapshotPollingInput) {
  React.useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let inFlight = false;
    const intervalMs = serverConnected ? 33 : 1000;
    const timer = window.setInterval(async () => {
      if (inFlight) {
        return;
      }
      inFlight = true;
      try {
        const snapshot = await client.latestSnapshot();
        setServerInfo(snapshot.server);
        setConnected(snapshot.buses.some((entry) => entry.status === "connected"));
        setBuses((current) =>
          current.map((bus) => {
            const status = snapshot.buses.find((entry) => entry.bus === bus.bus);
            if (!status) {
              return bus;
            }
            return {
              ...bus,
              status: status.status,
              frames: status.frames,
              errors: status.errors,
              rateHz: status.rate_hz,
              utilizationPercent: status.utilization_percent,
              saturatedLast1sMs: status.saturated_last_1s_ms,
              saturatedWorst1sMs: status.saturated_worst_1s_ms,
              message: status.message,
            };
          }),
        );
        if (!paused) {
          setFrames(snapshot.frames.map(mapSnapshotFrame));
        }
        if (snapshot.event_log) {
          setEventLog(
            snapshot.stream_dropped_count > 0
              ? `${snapshot.event_log} / stream dropped=${snapshot.stream_dropped_count}`
              : snapshot.event_log,
          );
        }
      } catch (error) {
        setEventLog(`snapshot failed: ${String(error)}`);
      } finally {
        inFlight = false;
      }
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [
    client,
    enabled,
    paused,
    serverConnected,
    setBuses,
    setConnected,
    setEventLog,
    setFrames,
    setServerInfo,
  ]);
}
