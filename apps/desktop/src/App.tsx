import React from "react";
import type {
  BusConfig,
  ParsePlotPreviewDto,
  PlotPointDto,
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
  appendUniquePlotPoints,
  appendUniqueSamples,
  filterRecentPlotPoints,
  maxRealtimePlotPoints,
  maxRealtimeSamples,
  plotVisibleWindowSeconds,
  resetSeenPlotPointKeys,
  resetSeenSampleKeys,
} from "./lib/plotHistory";
import { useDummyFrames } from "./hooks/useDummyFrames";
import { usePlotCanvas } from "./hooks/usePlotCanvas";
import { useSnapshotPolling } from "./hooks/useSnapshotPolling";
import "./styles.css";

const realtimePreviewIntervalMs = 100;
const plotRenderFrameMs = 1000 / 60;
const maxPreviewTableRows = 200;

export default function App() {
  const client = React.useMemo(() => getCanRushClient(), []);
  const plotCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const signalSampleKeysRef = React.useRef(new Set<string>());
  const plotPointKeysRef = React.useRef(new Set<string>());
  const plotPointsRef = React.useRef<PlotPointDto[]>([]);
  const plotSeriesRef = React.useRef<PlotSeries[]>(samplePlotSeries);
  const livePreviewSequenceRef = React.useRef(0);
  const realtimePlotTimerRef = React.useRef<number | null>(null);
  const realtimePlotInFlightRef = React.useRef(false);
  const livePlotCursorRef = React.useRef<number | null>(null);
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
  const [plotSeries, setPlotSeries] = React.useState(samplePlotSeries);
  const [selectedSeriesId, setSelectedSeriesId] = React.useState(samplePlotSeries[0].id);
  const [visibleSeriesIds, setVisibleSeriesIds] = React.useState<string[]>([
    samplePlotSeries[0].id,
  ]);
  const [signalSamples, setSignalSamples] = React.useState<SignalSampleDto[]>([]);
  const [plotPoints, setPlotPoints] = React.useState<PlotPointDto[]>([]);
  const [parsePreviewStatus, setParsePreviewStatus] = React.useState("not run");
  const [realtimePlot, setRealtimePlot] = React.useState(false);

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
  const selectedPanelTitle = selectedSeries.panelTitle;
  const displayedPlotPoints = plotPoints.filter((point) =>
    visibleSeriesIds.includes(point.series_id),
  );
  const visiblePlotPoints = filterRecentPlotPoints(displayedPlotPoints, plotVisibleWindowSeconds);
  const selectedSignalSamples = signalSamples.filter(
    (sample) => sample.signal_id === selectedSignal.id,
  );
  const selectedSeriesPoints = visiblePlotPoints.filter(
    (point) => point.series_id === selectedSeries.id,
  );
  const plotPointRows = visiblePlotPoints.slice(-maxPreviewTableRows);

  React.useEffect(() => {
    plotPointsRef.current = plotPoints;
  }, [plotPoints]);

  React.useEffect(() => {
    plotSeriesRef.current = plotSeries;
  }, [plotSeries]);

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
      setPlotPoints([]);
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
      const nextSeries = mapPlotLayout(layout);
      setPlotSeries(nextSeries);
      setSelectedSeriesId(nextSeries[0]?.id ?? "");
      setVisibleSeriesIds(nextSeries[0] ? [nextSeries[0].id] : []);
      setPlotLayoutName(layout.name || plotLayoutPath);
      setPlotPoints([]);
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

  async function toggleRealtimePlot() {
    if (realtimePlot) {
      stopRealtimePlotLoop();
      setRealtimePlot(false);
      setParsePreviewStatus("live stopped");
      return;
    }

    const loadedSignals = await loadParseConfig();
    const loadedSeries = await loadPlotLayout();
    if (!loadedSignals || !loadedSeries) {
      return;
    }
    const liveSeriesIds = visibleSeriesIds.filter((id) =>
      loadedSeries.some((series) => series.id === id),
    );
    const selectedLiveSeriesIds = liveSeriesIds.length > 0 ? liveSeriesIds : loadedSeries[0] ? [loadedSeries[0].id] : [];
    setVisibleSeriesIds(selectedLiveSeriesIds);
    setParsePreviewStatus("live starting");
    setSignalSamples([]);
    setPlotPoints([]);
    livePreviewSequenceRef.current = 0;
    livePlotCursorRef.current = null;
    signalSampleKeysRef.current.clear();
    plotPointKeysRef.current.clear();
    try {
      const preview = await client.parsePlotLiveSince({
        parserSignals: loadedSignals,
        plotSeries: loadedSeries,
        sinceSequence: livePlotCursorRef.current,
        selectedSeriesIds: selectedLiveSeriesIds,
      });
      livePlotCursorRef.current = preview.next_sequence;
      applyParsePlotPreview(preview, "live", false);
    } catch (error) {
      setEventLog(`parse/plot preview failed: ${String(error)}`);
      return;
    }
    setRealtimePlot(true);
    scheduleRealtimePlotRefresh(loadedSignals, loadedSeries, selectedLiveSeriesIds);
  }

  function applyParsePlotPreview(preview: ParsePlotPreviewDto, sourceLabel: string, append: boolean) {
    if (append) {
      setSignalSamples((current) =>
        appendUniqueSamples(current, preview.samples, signalSampleKeysRef.current),
      );
      setPlotPoints((current) =>
        appendUniquePlotPoints(current, preview.points, plotPointKeysRef.current),
      );
    } else {
      setSignalSamples(preview.samples);
      setPlotPoints(preview.points);
      resetSeenSampleKeys(preview.samples, signalSampleKeysRef.current);
      resetSeenPlotPointKeys(preview.points, plotPointKeysRef.current);
    }
    setParsePreviewStatus(
      `${preview.samples.length} sample(s), ${preview.points.length} point(s) ${sourceLabel}`,
    );
  }

  function stampLivePreview(preview: ParsePlotPreviewDto) {
    livePreviewSequenceRef.current += 1;
    const timestamp = (Date.now() / 1000).toFixed(3);
    const sequenceBase = livePreviewSequenceRef.current * 10000;
    return {
      samples: preview.samples.map((sample, index) => ({
        ...sample,
        timestamp_host: timestamp,
        source_sequence: sequenceBase + index,
      })),
      points: preview.points.map((point, index) => ({
        ...point,
        timestamp_host: timestamp,
        source_sequence: sequenceBase + index,
      })),
    };
  }

  function stopRealtimePlotLoop() {
    if (realtimePlotTimerRef.current !== null) {
      window.clearTimeout(realtimePlotTimerRef.current);
      realtimePlotTimerRef.current = null;
    }
    realtimePlotInFlightRef.current = false;
  }

  function scheduleRealtimePlotRefresh(
    loadedSignals: typeof parserSignals,
    loadedSeries: typeof plotSeries,
    selectedSeriesIds: string[],
  ) {
    if (realtimePlotTimerRef.current !== null) {
      window.clearTimeout(realtimePlotTimerRef.current);
    }
    const refresh = async () => {
      if (realtimePlotInFlightRef.current) {
        realtimePlotTimerRef.current = window.setTimeout(refresh, realtimePreviewIntervalMs);
        return;
      }
      realtimePlotInFlightRef.current = true;
      try {
        const preview = await client.parsePlotLiveSince({
          parserSignals: loadedSignals,
          plotSeries: loadedSeries,
          sinceSequence: livePlotCursorRef.current,
          selectedSeriesIds,
        });
        livePlotCursorRef.current = preview.next_sequence;
        appendLiveParsePlotPreview(preview);
        setEventLog(
          client.isPreview
            ? "browser preview mode; live plot preview is simulated"
            : `live parsed ${preview.samples.length} sample(s), built ${preview.points.length} plot point(s), dropped ${preview.dropped_frames} frame(s)`,
        );
      } catch (error) {
        setEventLog(`live parse/plot preview failed: ${String(error)}`);
      } finally {
        realtimePlotInFlightRef.current = false;
        realtimePlotTimerRef.current = window.setTimeout(refresh, realtimePreviewIntervalMs);
      }
    };
    realtimePlotTimerRef.current = window.setTimeout(refresh, realtimePreviewIntervalMs);
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
      const displayPreview = append ? stampLivePreview(preview) : preview;
      applyParsePlotPreview(
        displayPreview,
        append ? "live" : client.isPreview ? "preview" : "",
        append,
      );
      setEventLog(
        client.isPreview
          ? "browser preview mode; parse and plot preview is simulated"
          : `parsed ${preview.samples.length} sample(s), built ${preview.points.length} plot point(s)`,
      );
    } catch (error) {
      setEventLog(`parse/plot preview failed: ${String(error)}`);
    }
  }

  function appendLiveParsePlotPreview(preview: ParsePlotPreviewDto) {
    setSignalSamples((current) => {
      const next = [...current, ...preview.samples].slice(-maxRealtimeSamples);
      resetSeenSampleKeys(next, signalSampleKeysRef.current);
      return next;
    });
    setPlotPoints((current) => {
      const next = [...current, ...preview.points].slice(-maxRealtimePlotPoints);
      resetSeenPlotPointKeys(next, plotPointKeysRef.current);
      return next;
    });
    setParsePreviewStatus(
      `${preview.samples.length} sample(s), ${preview.points.length} point(s) live`,
    );
  }

  function resetPlotHistory() {
    setSignalSamples([]);
    setPlotPoints([]);
    livePreviewSequenceRef.current = 0;
    livePlotCursorRef.current = null;
    signalSampleKeysRef.current.clear();
    plotPointKeysRef.current.clear();
  }

  function toggleVisibleSeries(seriesId: string) {
    const next = visibleSeriesIds.includes(seriesId)
      ? visibleSeriesIds.filter((id) => id !== seriesId)
      : [...visibleSeriesIds, seriesId];
    setVisibleSeriesIds(next);
    resetPlotHistory();
    if (realtimePlot) {
      scheduleRealtimePlotRefresh(parserSignals, plotSeries, next);
    }
  }

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
      setPlotPoints(preview.points);
      resetSeenSampleKeys(preview.samples, signalSampleKeysRef.current);
      resetSeenPlotPointKeys(preview.points, plotPointKeysRef.current);
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

  React.useEffect(() => stopRealtimePlotLoop, []);

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

  usePlotCanvas({
    enabled: workspaceView === "plotter",
    canvasRef: plotCanvasRef,
    seriesRef: plotSeriesRef,
    pointsRef: plotPointsRef,
    frameMs: plotRenderFrameMs,
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
          capturePreviewPath={capturePreviewPath}
          plotSeries={plotSeries}
          selectedSeries={selectedSeries}
          selectedSeriesId={selectedSeriesId}
          visibleSeriesIds={visibleSeriesIds}
          selectedSeriesPoints={selectedSeriesPoints}
          selectedPanelTitle={selectedPanelTitle}
          visiblePlotPoints={visiblePlotPoints}
          plotPointRows={plotPointRows}
          plotPoints={plotPoints}
          signalSampleCount={signalSamples.length}
          parsePreviewStatus={parsePreviewStatus}
          realtimePlot={realtimePlot}
          plotVisibleWindowSeconds={plotVisibleWindowSeconds}
          plotCanvasRef={plotCanvasRef}
          onPlotLayoutPathChange={setPlotLayoutPath}
          onCapturePreviewPathChange={setCapturePreviewPath}
          onLoadPlotLayout={loadPlotLayout}
          onRefreshParsePlotPreview={() => refreshParsePlotPreview()}
          onRefreshCaptureFilePreview={refreshCaptureFilePreview}
          onToggleRealtimePlot={toggleRealtimePlot}
          onClearPlot={() => {
            setSignalSamples([]);
            setPlotPoints([]);
            livePlotCursorRef.current = null;
            signalSampleKeysRef.current.clear();
            plotPointKeysRef.current.clear();
            setParsePreviewStatus("cleared");
          }}
          onSelectedSeriesChange={setSelectedSeriesId}
          onVisibleSeriesToggle={toggleVisibleSeries}
        />
      ) : null}

      <StatusStrip eventLog={eventLog} paused={paused} connected={connected} />
    </main>
  );
}
