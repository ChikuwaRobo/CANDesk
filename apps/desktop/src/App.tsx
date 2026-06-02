import React from "react";
import type {
  BusConfig,
  PlotSeries,
  SerialPortInfo,
  SignalSampleDto,
  SortMode,
  WorkspaceView,
} from "./types";
import {
  initialBuses,
  initialServerInfo,
  sampleFrames,
  sampleParserSignals,
  samplePlotSeries,
} from "./fixtures/previewData";
import { getCanRushClient } from "./api/client";
import { AppHeader } from "./components/AppHeader";
import { MonitorView } from "./components/MonitorView";
import { ParserView } from "./components/ParserView";
import { PlotterView } from "./components/PlotterView";
import { StatusStrip } from "./components/StatusStrip";
import {
  compareFrames,
  mergeFramesById,
  numericValue,
} from "./lib/frames";
import { mapParseConfig, mapPlotLayout } from "./lib/parserMapping";
import {
  resetSeenSampleKeys,
} from "./lib/plotHistory";
import { autoAssignPlotSeriesColors } from "./lib/plotColors";
import { useDummyFrames } from "./hooks/useDummyFrames";
import { useSnapshotPolling } from "./hooks/useSnapshotPolling";
import "./styles.css";

export default function App() {
  const client = React.useMemo(() => getCanRushClient(), []);
  const signalSampleKeysRef = React.useRef(new Set<string>());
  const plotterLiveTimerRef = React.useRef<number | null>(null);
  const plotterLiveInFlightRef = React.useRef(false);
  const plotterLiveCursorRef = React.useRef<number | null>(null);
  const plotterAutoStartRef = React.useRef(false);
  const [workspaceView, setWorkspaceView] = React.useState<WorkspaceView>("monitor");
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
  const [parseConfigPath, setParseConfigPath] = React.useState(
    "examples/orion.canrush-parse.json",
  );
  const [plotLayoutPath, setPlotLayoutPath] = React.useState(
    "examples/orion.canrush-layout.json",
  );
  const [capturePreviewPath, setCapturePreviewPath] = React.useState(
    "examples/orion-sample-capture.csv",
  );
  const [parseConfigName, setParseConfigName] = React.useState("example.canrush-parse.json");
  const [plotLayoutName, setPlotLayoutName] = React.useState("example.canrush-layout.json");
  const [parserSignals, setParserSignals] = React.useState(sampleParserSignals);
  const [selectedSignalId, setSelectedSignalId] = React.useState(sampleParserSignals[0].id);
  const [plotSeries, setPlotSeries] = React.useState(autoAssignPlotSeriesColors(samplePlotSeries));
  const [selectedSeriesId, setSelectedSeriesId] = React.useState(samplePlotSeries[0].id);
  const [visibleSeriesIds, setVisibleSeriesIds] = React.useState<string[]>([
    samplePlotSeries[0].id,
  ]);
  const [signalSamples, setSignalSamples] = React.useState<SignalSampleDto[]>([]);
  const [plotterCurrentSamples, setPlotterCurrentSamples] = React.useState<Record<string, SignalSampleDto>>({});
  const [plotterValuesRunning, setPlotterValuesRunning] = React.useState(false);
  const [parsePreviewStatus, setParsePreviewStatus] = React.useState("not run");

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
  const selectedSignal =
    parserSignals.find((signal) => signal.id === selectedSignalId) ?? sampleParserSignals[0]!;
  const selectedSeries =
    plotSeries.find((series) => series.id === selectedSeriesId) ?? samplePlotSeries[0]!;
  const selectedSignalSamples = signalSamples.filter(
    (sample) => sample.signal_id === selectedSignal.id,
  );
  const selectedPlotterValues = plotSeries
    .filter((series) => visibleSeriesIds.includes(series.id))
    .map((series) => ({
      series,
      sample: plotterCurrentSamples[series.signalId],
    }));

  React.useEffect(() => {
    if (visibleFrames.length === 0) {
      return;
    }
    if (!visibleFrames.some((frame) => frame.rowKey === selectedFrameId)) {
      setSelectedFrameId(visibleFrames[0].rowKey);
    }
  }, [selectedFrameId, visibleFrames]);

  React.useEffect(() => {
    if (workspaceView !== "plotter" || !plotterValuesRunning) {
      if (plotterLiveTimerRef.current !== null) {
        window.clearTimeout(plotterLiveTimerRef.current);
        plotterLiveTimerRef.current = null;
      }
      plotterLiveInFlightRef.current = false;
      return undefined;
    }

    const refresh = async () => {
      if (plotterLiveInFlightRef.current) {
        plotterLiveTimerRef.current = window.setTimeout(refresh, 50);
        return;
      }
      plotterLiveInFlightRef.current = true;
      try {
        const preview = await client.parsePlotLiveSince({
          parserSignals,
          plotSeries,
          sinceSequence: plotterLiveCursorRef.current,
          selectedSeriesIds: visibleSeriesIds,
        });
        plotterLiveCursorRef.current = preview.next_sequence;
        if (preview.samples.length > 0) {
          setPlotterCurrentSamples((current) => {
            const next = { ...current };
            for (const sample of preview.samples) {
              next[sample.signal_id] = sample;
            }
            return next;
          });
          setSignalSamples(preview.samples);
        }
        setParsePreviewStatus(
          `${preview.samples.length} sample(s), ${preview.points.length} point(s) live`,
        );
      } catch (error) {
        setEventLog(`plotter value refresh failed: ${String(error)}`);
      } finally {
        plotterLiveInFlightRef.current = false;
        plotterLiveTimerRef.current = window.setTimeout(refresh, 50);
      }
    };

    plotterLiveTimerRef.current = window.setTimeout(refresh, 0);
    return () => {
      if (plotterLiveTimerRef.current !== null) {
        window.clearTimeout(plotterLiveTimerRef.current);
        plotterLiveTimerRef.current = null;
      }
      plotterLiveInFlightRef.current = false;
    };
  }, [client, parserSignals, plotSeries, plotterValuesRunning, visibleSeriesIds, workspaceView]);

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

  async function loadParseConfig() {
    try {
      const config = await client.loadParseConfig(parseConfigPath);
      const nextSignals = mapParseConfig(config);
      setParserSignals(nextSignals);
      setSelectedSignalId(nextSignals[0]?.id ?? "");
      setParseConfigName(config.name || parseConfigPath);
      setSignalSamples([]);
      setParsePreviewStatus("config loaded");
      setEventLog(
        client.isPreview
          ? "browser preview mode; parse config load is simulated"
          : `loaded parse config: ${nextSignals.length} signal(s)`,
      );
      return nextSignals;
    } catch (error) {
      setEventLog(`parse config load failed: ${String(error)}`);
      return null;
    }
  }

  async function loadPlotLayout() {
    try {
      const layout = await client.loadPlotLayout(plotLayoutPath);
      const nextSeries = autoAssignPlotSeriesColors(mapPlotLayout(layout));
      setPlotSeries(nextSeries);
      setSelectedSeriesId(nextSeries[0]?.id ?? "");
      setVisibleSeriesIds(nextSeries[0] ? [nextSeries[0].id] : []);
      setPlotterCurrentSamples({});
      plotterLiveCursorRef.current = null;
      setPlotLayoutName(layout.name || plotLayoutPath);
      setParsePreviewStatus("layout loaded");
      setEventLog(
        client.isPreview
          ? "browser preview mode; plot layout load is simulated"
          : `loaded plot layout: ${nextSeries.length} series`,
      );
      return nextSeries;
    } catch (error) {
      setEventLog(`plot layout load failed: ${String(error)}`);
      return null;
    }
  }

  async function refreshParsePlotPreview(append = false) {
    try {
      const preview = append
        ? await client.parsePlotPreviewLive({ parserSignals, plotSeries })
        : await client.parsePlotPreview({
            parseConfigPath,
            plotLayoutPath,
            parserSignals,
            plotSeries,
          });
      setSignalSamples(preview.samples);
      resetSeenSampleKeys(preview.samples, signalSampleKeysRef.current);
      setParsePreviewStatus(
        `${preview.samples.length} sample(s), ${preview.points.length} point(s) ${append ? "live" : client.isPreview ? "preview" : ""}`,
      );
      setEventLog(
        client.isPreview
          ? "browser preview mode; parse preview is simulated"
          : `parsed ${preview.samples.length} sample(s), built ${preview.points.length} plot point(s)`,
      );
    } catch (error) {
      setEventLog(`parse preview failed: ${String(error)}`);
    }
  }

  function toggleVisibleSeries(seriesId: string) {
    const next = visibleSeriesIds.includes(seriesId)
      ? visibleSeriesIds.filter((id) => id !== seriesId)
      : [...visibleSeriesIds, seriesId];
    setVisibleSeriesIds(next);
    plotterLiveCursorRef.current = null;
  }

  function updatePlotSeriesColor(seriesId: string, color: string) {
    setPlotSeries((current) =>
      current.map((series) => (series.id === seriesId ? { ...series, color } : series)),
    );
  }

  React.useEffect(() => {
    if (workspaceView !== "plotter" || plotterAutoStartRef.current) {
      return;
    }
    plotterAutoStartRef.current = true;
    const startPlotter = async () => {
      setParsePreviewStatus("starting");
      const [loadedSignals, loadedSeries] = await Promise.all([
        loadParseConfig(),
        loadPlotLayout(),
      ]);
      if (!loadedSignals || !loadedSeries) {
        setPlotterValuesRunning(false);
        return;
      }
      plotterLiveCursorRef.current = null;
      setPlotterValuesRunning(true);
      setParsePreviewStatus("running");
    };
    void startPlotter();
  }, [workspaceView]);

  async function refreshCaptureFilePreview() {
    try {
      const preview = await client.parsePlotCaptureFile({
        parseConfigPath,
        plotLayoutPath,
        capturePath: capturePreviewPath,
        parserSignals,
        plotSeries,
      });
      setSignalSamples(preview.samples);
      resetSeenSampleKeys(preview.samples, signalSampleKeysRef.current);
      setParsePreviewStatus(
        `${preview.samples.length} sample(s), ${preview.points.length} point(s) from CSV`,
      );
      setEventLog(
        client.isPreview
          ? "browser preview mode; capture file preview is simulated"
          : `parsed capture CSV: ${preview.samples.length} sample(s), ${preview.points.length} plot point(s)`,
      );
    } catch (error) {
      setEventLog(`capture preview failed: ${String(error)}`);
    }
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
        workspaceView={workspaceView}
        onWorkspaceViewChange={setWorkspaceView}
        onRefreshPorts={refreshPorts}
        onConnectAll={connectAll}
        onDisconnectAll={disconnectAll}
      />

      {workspaceView === "monitor" ? (
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
      ) : null}

      {workspaceView === "parser" ? (
        <ParserView
          parseConfigName={parseConfigName}
          parseConfigPath={parseConfigPath}
          capturePreviewPath={capturePreviewPath}
          parserSignals={parserSignals}
          selectedSignal={selectedSignal}
          selectedSignalId={selectedSignalId}
          selectedSignalSamples={selectedSignalSamples}
          signalSamples={signalSamples}
          parsePreviewStatus={parsePreviewStatus}
          onParseConfigPathChange={setParseConfigPath}
          onCapturePreviewPathChange={setCapturePreviewPath}
          onLoadParseConfig={loadParseConfig}
          onRefreshParsePlotPreview={() => refreshParsePlotPreview()}
          onRefreshCaptureFilePreview={refreshCaptureFilePreview}
          onSelectedSignalChange={setSelectedSignalId}
        />
      ) : null}

      {workspaceView === "plotter" ? (
        <PlotterView
          plotLayoutName={plotLayoutName}
          plotLayoutPath={plotLayoutPath}
          plotSeries={plotSeries}
          selectedSeriesId={selectedSeriesId}
          visibleSeriesIds={visibleSeriesIds}
          currentValues={selectedPlotterValues}
          valuesRunning={plotterValuesRunning}
          signalSampleCount={signalSamples.length}
          parsePreviewStatus={parsePreviewStatus}
          onPlotLayoutPathChange={setPlotLayoutPath}
          onSelectedSeriesChange={setSelectedSeriesId}
          onVisibleSeriesToggle={toggleVisibleSeries}
          onSeriesColorChange={updatePlotSeriesColor}
        />
      ) : null}

      <StatusStrip eventLog={eventLog} paused={paused} connected={connected} />
    </main>
  );
}
