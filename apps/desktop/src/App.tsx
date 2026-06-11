import React from "react";
import type { BusConfig, SerialPortInfo, SortMode } from "./types";
import {
  initialBuses,
  initialServerInfo,
  sampleFrames,
} from "./fixtures/previewData";
import { getCanRushClient } from "./api/client";
import { AppHeader } from "./components/AppHeader";
import { MonitorView } from "./components/MonitorView";
import { StatusStrip } from "./components/StatusStrip";
import {
  compareFrames,
  mergeFramesById,
  numericValue,
} from "./lib/frames";
import { useDummyFrames } from "./hooks/useDummyFrames";
import { useSnapshotPolling } from "./hooks/useSnapshotPolling";
import "./styles.css";

export default function App() {
  const client = React.useMemo(() => getCanRushClient(), []);
  const [ports, setPorts] = React.useState<SerialPortInfo[]>([]);
  const [buses, setBuses] = React.useState(initialBuses);
  const [frames, setFrames] = React.useState(sampleFrames);
  const [selectedFrameId, setSelectedFrameId] = React.useState(sampleFrames[0].rowKey);
  const [busFilter, setBusFilter] = React.useState("ALL");
  const [query, setQuery] = React.useState("");
  const [sortMode, setSortMode] = React.useState<SortMode>("bus");
  const [mergeBuses, setMergeBuses] = React.useState(false);
  const [debugDummy, setDebugDummy] = React.useState(false);
  const [paused, setPaused] = React.useState(false);
  const [connected, setConnected] = React.useState(false);
  const [serverInfo, setServerInfo] = React.useState(initialServerInfo);
  const [eventLog, setEventLog] = React.useState("server client ready");

  const displayFrames = mergeBuses ? mergeFramesById(frames) : frames;
  const visibleFrames = displayFrames
    .filter((frame) => {
      const busMatches = mergeBuses || busFilter === "ALL" || frame.bus === busFilter;
      const queryMatches = frame.id.toLowerCase().includes(query.toLowerCase());
      return busMatches && queryMatches;
    })
    .sort((a, b) => compareFrames(a, b, sortMode));
  const maxVisibleRateHz = Math.max(
    0,
    ...visibleFrames.map((frame) => numericValue(frame.rateHz)).filter(Number.isFinite),
  );
  const selectedFrame =
    visibleFrames.find((frame) => frame.rowKey === selectedFrameId) ?? visibleFrames[0];

  React.useEffect(() => {
    if (visibleFrames.length === 0) {
      return;
    }
    if (!visibleFrames.some((frame) => frame.rowKey === selectedFrameId)) {
      setSelectedFrameId(visibleFrames[0].rowKey);
    }
  }, [selectedFrameId, visibleFrames]);

  async function refreshPorts() {
    try {
      const listed = await client.listSerialPorts();
      setPorts(listed);
      setEventLog(
        client.isPreview
          ? "browser preview mode; using sample serial ports"
          : `${listed.length} serial port(s) detected`,
      );
      setBuses((current) =>
        current.map((bus) => {
          const matched = listed.find((port) => port.port_name === bus.port);
          return { ...bus, status: matched ? "ready" : "idle" };
        }),
      );
    } catch (error) {
      setEventLog(`port refresh failed: ${String(error)}`);
    }
  }

  async function startServer() {
    try {
      const info = await client.startLocalServer();
      setServerInfo(info);
      setEventLog(info.message);
    } catch (error) {
      setServerInfo((current) => ({
        ...current,
        connected: false,
        process_state: current.process_state === "running" ? "unknown" : current.process_state,
        message: String(error),
      }));
      setEventLog(`server start failed: ${String(error)}`);
    }
  }

  async function connectAll() {
    if (client.isPreview) {
      setConnected(true);
      setBuses((current) =>
        current.map((bus) => ({
          ...bus,
          status: bus.port ? "connected" : "error",
          frames: bus.port ? bus.frames : 0,
          errors: bus.port ? bus.errors : bus.errors + 1,
          rateHz: bus.port ? "preview" : "-",
          utilizationPercent: bus.port ? "preview" : "-",
          saturatedLast1sMs: "-",
          saturatedWorst1sMs: "-",
          message: bus.port ? "preview receiving" : "port is not selected",
        })),
      );
      setFrames((current) =>
        current.map((frame, index) => ({
          ...frame,
          lastSeen: index === 0 ? "now" : "now - 40 ms",
          rateHz: index === 0 ? "4307.5" : "5503.5",
          count: index === 0 ? 8622 : 11007,
        })),
      );
      setEventLog("browser preview mode; connection state is simulated");
      return;
    }

    try {
      for (const bus of buses) {
        if (!bus.port) {
          throw new Error(`${bus.bus} port is not selected`);
        }
        await client.connectBus({
          bus: bus.bus,
          port: bus.port,
          bitrate: bus.bitrate,
          dataBitrate: bus.dataBitrate,
          listenOnly: bus.listenOnly,
        });
      }
      setConnected(true);
      setEventLog("all buses connecting");
    } catch (error) {
      setEventLog(`connect failed: ${String(error)}`);
    }
  }

  async function disconnectAll() {
    if (!client.isPreview) {
      try {
        await client.disconnectAll();
      } catch (error) {
        setEventLog(`disconnect failed: ${String(error)}`);
        return;
      }
    }
    setConnected(false);
    setBuses((current) =>
      current.map((bus) => ({
        ...bus,
        status: "ready",
        rateHz: "-",
        utilizationPercent: "-",
        saturatedLast1sMs: "-",
        saturatedWorst1sMs: "-",
        message: "disconnected",
      })),
    );
    setEventLog("all buses disconnected");
  }

  async function clearView() {
    if (!client.isPreview) {
      try {
        await client.clearLatest();
      } catch (error) {
        setEventLog(`clear failed: ${String(error)}`);
        return;
      }
    }
    setFrames([]);
    setEventLog("view cleared");
  }

  function updateBus(index: number, patch: Partial<BusConfig>) {
    setBuses((current) =>
      current.map((bus, busIndex) => (busIndex === index ? { ...bus, ...patch } : bus)),
    );
  }

  React.useEffect(() => {
    void refreshPorts();
    void startServer();
  }, []);

  useSnapshotPolling({
    client,
    enabled: !client.isPreview && !debugDummy,
    paused,
    serverConnected: serverInfo.connected,
    setServerInfo,
    setConnected,
    setBuses,
    setFrames,
    setEventLog,
  });

  useDummyFrames({
    enabled: debugDummy,
    paused,
    setConnected,
    setBuses,
    setFrames,
    setEventLog,
  });

  return (
    <main className="app-shell">
      <AppHeader
        serverInfo={serverInfo}
        onRefreshPorts={refreshPorts}
        onConnectAll={connectAll}
        onDisconnectAll={disconnectAll}
      />

      <MonitorView
        buses={buses}
        ports={ports}
        visibleFrames={visibleFrames}
        selectedFrame={selectedFrame}
        selectedFrameId={selectedFrameId}
        busFilter={busFilter}
        mergeBuses={mergeBuses}
        debugDummy={debugDummy}
        sortMode={sortMode}
        query={query}
        paused={paused}
        maxVisibleRateHz={maxVisibleRateHz}
        onUpdateBus={updateBus}
        onBusFilterChange={setBusFilter}
        onMergeBusesChange={setMergeBuses}
        onDebugDummyChange={setDebugDummy}
        onSortModeChange={setSortMode}
        onQueryChange={setQuery}
        onTogglePaused={() => setPaused((value) => !value)}
        onClearView={clearView}
        onSelectedFrameChange={setSelectedFrameId}
      />

      <StatusStrip eventLog={eventLog} paused={paused} connected={connected} />
    </main>
  );
}
