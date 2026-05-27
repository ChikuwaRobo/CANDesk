import React from "react";
import ReactDOM from "react-dom/client";
import {
  Activity,
  Cable,
  CirclePause,
  Database,
  Download,
  FileJson,
  LineChart,
  Plug,
  RefreshCw,
  Search,
  Server,
  SlidersHorizontal,
  Square,
  Unplug,
} from "lucide-react";
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
import { makeDummyFrames } from "./fixtures/orionDummy";
import {
  compareFrames,
  formatServerStartedAt,
  mapSnapshotFrame,
  mergeFramesById,
  numericValue,
  rateBarWidthPercent,
} from "./lib/frames";
import { mapParseConfig, mapPlotLayout, sampleSignalValue } from "./lib/parserMapping";
import {
  appendUniquePlotPoints,
  appendUniqueSamples,
  filterRecentPlotPoints,
  plotVisibleWindowSeconds,
  resetSeenPlotPointKeys,
  resetSeenSampleKeys,
} from "./lib/plotHistory";
import { drawPlotCanvas } from "./lib/plotCanvas";
import "./styles.css";

const realtimePreviewIntervalMs = 100;
const plotRenderFrameMs = 1000 / 30;
const maxPreviewTableRows = 200;

function App() {
  const client = React.useMemo(() => getCanRushClient(), []);
  const plotCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const signalSampleKeysRef = React.useRef(new Set<string>());
  const plotPointKeysRef = React.useRef(new Set<string>());
  const plotPointsRef = React.useRef<PlotPointDto[]>([]);
  const plotSeriesRef = React.useRef<PlotSeries[]>(samplePlotSeries);
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
  const visiblePlotPoints = filterRecentPlotPoints(plotPoints, plotVisibleWindowSeconds);
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
      setRealtimePlot(false);
      setParsePreviewStatus("live stopped");
      return;
    }

    const loadedSignals = await loadParseConfig();
    const loadedSeries = await loadPlotLayout();
    if (!loadedSignals || !loadedSeries) {
      return;
    }
    setSignalSamples([]);
    setPlotPoints([]);
    signalSampleKeysRef.current.clear();
    plotPointKeysRef.current.clear();
    try {
      const preview = await client.parsePlotPreviewLive({
        parserSignals: loadedSignals,
        plotSeries: loadedSeries,
      });
      applyParsePlotPreview(preview, "live", false);
    } catch (error) {
      setEventLog(`parse/plot preview failed: ${String(error)}`);
      return;
    }
    setRealtimePlot(true);
    setParsePreviewStatus("live starting");
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
      applyParsePlotPreview(preview, append ? "live" : client.isPreview ? "preview" : "", append);
      setEventLog(
        client.isPreview
          ? "browser preview mode; parse and plot preview is simulated"
          : `parsed ${preview.samples.length} sample(s), built ${preview.points.length} plot point(s)`,
      );
    } catch (error) {
      setEventLog(`parse/plot preview failed: ${String(error)}`);
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
  }, []);

  React.useEffect(() => {
    if (client.isPreview || debugDummy) {
      return undefined;
    }

    let inFlight = false;
    const intervalMs = serverInfo.connected ? 33 : 1000;
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
            };
          }),
        );
        if (!paused) {
          const nextFrames = snapshot.frames.map(mapSnapshotFrame);
          setFrames(nextFrames);
        }
        if (snapshot.event_log) {
          setEventLog(snapshot.event_log);
        }
      } catch (error) {
        setEventLog(`snapshot failed: ${String(error)}`);
      } finally {
        inFlight = false;
      }
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [client, paused, debugDummy, serverInfo.connected]);

  React.useEffect(() => {
    if (!debugDummy) {
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
  }, [debugDummy, paused]);

  React.useEffect(() => {
    if (!realtimePlot) {
      return undefined;
    }

    let inFlight = false;
    const timer = window.setInterval(() => {
      if (inFlight) {
        return;
      }
      inFlight = true;
      void refreshParsePlotPreview(true).finally(() => {
        inFlight = false;
      });
    }, realtimePreviewIntervalMs);

    return () => window.clearInterval(timer);
  }, [realtimePlot, parseConfigPath, plotLayoutPath, parserSignals, plotSeries]);

  React.useEffect(() => {
    if (workspaceView !== "plotter") {
      return undefined;
    }

    let animationFrame = 0;
    let lastDrawAt = 0;
    const draw = (timestamp: number) => {
      if (timestamp - lastDrawAt >= plotRenderFrameMs) {
        const canvas = plotCanvasRef.current;
        if (canvas) {
          drawPlotCanvas(canvas, plotSeriesRef.current, plotPointsRef.current);
        }
        lastDrawAt = timestamp;
      }
      animationFrame = window.requestAnimationFrame(draw);
    };
    animationFrame = window.requestAnimationFrame(draw);

    return () => window.cancelAnimationFrame(animationFrame);
  }, [workspaceView]);

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <h1>CANRush</h1>
          <div className="server-summary" aria-label="local server status">
            <span className={`server-dot ${serverInfo.connected ? "online" : "offline"}`} />
            <span>{serverInfo.endpoint}</span>
          <span>{serverInfo.server_name}</span>
          <span>{serverInfo.protocol_version}</span>
          <span>{serverInfo.owner}</span>
          <span>{serverInfo.process_state}</span>
          <span>{serverInfo.read_only ? "read-only" : "admin"}</span>
          <span>started {formatServerStartedAt(serverInfo.started_at_unix_ms)}</span>
          {serverInfo.exit_reason ? <span>{serverInfo.exit_reason}</span> : null}
        </div>
      </div>
      <div className="toolbar" aria-label="main actions">
          <div className="workspace-tabs" role="tablist" aria-label="workspace view">
            {([
              ["monitor", "Monitor", Activity],
              ["parser", "Parser", FileJson],
              ["plotter", "Plotter", LineChart],
            ] as const).map(([value, label, Icon]) => (
              <button
                type="button"
                key={value}
                className={workspaceView === value ? "active" : ""}
                onClick={() => setWorkspaceView(value)}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>
          <button type="button" onClick={startServer} title="ローカルサーバー起動">
            <Server size={16} />
            Start Server
          </button>
          <button type="button" onClick={refreshPorts} title="ポート再読み込み">
            <RefreshCw size={16} />
            Refresh
          </button>
          <button type="button" onClick={connectAll} title="全バス接続">
            <Plug size={16} />
            Connect
          </button>
          <button type="button" onClick={disconnectAll} title="全バス切断">
            <Unplug size={16} />
            Disconnect
          </button>
          <button type="button" title="GUIキャプチャは後続実装" disabled>
            <Download size={16} />
            Capture CSV
          </button>
        </div>
      </header>

      {workspaceView === "monitor" ? (
        <>
      <section className="content-grid">
        <aside className="bus-panel" aria-label="bus settings">
          <div className="panel-heading">
            <Cable size={18} />
            <h2>Bus</h2>
          </div>
          {buses.map((bus, index) => (
            <article className="bus-card" key={bus.bus}>
              <div className="bus-card-header">
                <strong>{bus.bus}</strong>
                <span className={`status-pill ${bus.status}`}>{bus.status}</span>
              </div>
              <label>
                Port
                <select
                  value={bus.port}
                  onChange={(event) => updateBus(index, { port: event.target.value })}
                >
                  <option value="">未選択</option>
                  {ports.map((port) => (
                    <option value={port.port_name} key={`${bus.bus}-${port.port_name}`}>
                      {port.port_name}
                    </option>
                  ))}
                  {!ports.some((port) => port.port_name === bus.port) && bus.port ? (
                    <option value={bus.port}>{bus.port}</option>
                  ) : null}
                </select>
              </label>
              <div className="field-row">
                <label>
                  Bitrate
                  <select
                    value={bus.bitrate}
                    onChange={(event) => updateBus(index, { bitrate: event.target.value })}
                  >
                    <option value="S4">125k</option>
                    <option value="S6">500k</option>
                    <option value="S8">1M</option>
                  </select>
                </label>
                <label>
                  Data
                  <select
                    value={bus.dataBitrate}
                    onChange={(event) => updateBus(index, { dataBitrate: event.target.value })}
                  >
                    <option value="Y1">1M</option>
                    <option value="Y2">2M</option>
                    <option value="Y5">5M</option>
                  </select>
                </label>
              </div>
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={bus.listenOnly}
                  onChange={(event) => updateBus(index, { listenOnly: event.target.checked })}
                />
                Listen only
              </label>
              <dl className="bus-stats">
                <div>
                  <dt>Frames</dt>
                  <dd>{bus.frames.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Errors</dt>
                  <dd>{bus.errors.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Hz</dt>
                  <dd>{bus.rateHz}</dd>
                </div>
                <div>
                  <dt>Load</dt>
                  <dd>{bus.utilizationPercent === "-" ? "-" : `${bus.utilizationPercent}%`}</dd>
                </div>
                <div>
                  <dt>Full 1s</dt>
                  <dd>{bus.saturatedLast1sMs === "-" ? "-" : `${bus.saturatedLast1sMs} ms`}</dd>
                </div>
                <div>
                  <dt>Worst</dt>
                  <dd>{bus.saturatedWorst1sMs === "-" ? "-" : `${bus.saturatedWorst1sMs} ms`}</dd>
                </div>
              </dl>
            </article>
          ))}
        </aside>

        <section className="table-panel" aria-label="latest frames">
          <div className="table-tools">
            <div className="segmented" role="group" aria-label="bus filter">
              {["ALL", "CAN0", "CAN1"].map((value) => (
                <button
                  type="button"
                  key={value}
                  className={busFilter === value ? "active" : ""}
                  onClick={() => setBusFilter(value)}
                >
                  {value}
                </button>
              ))}
            </div>
            <label className="checkbox-line table-toggle">
              <input
                type="checkbox"
                checked={mergeBuses}
                onChange={(event) => setMergeBuses(event.target.checked)}
              />
              Merge buses
            </label>
            <label className="checkbox-line table-toggle">
              <input
                type="checkbox"
                checked={debugDummy}
                onChange={(event) => setDebugDummy(event.target.checked)}
              />
              Dummy data
            </label>
            <div className="segmented sort-segmented" role="group" aria-label="sort mode">
              {([
                ["bus", "Bus"],
                ["id", "ID"],
                ["recent", "Recent"],
              ] as Array<[SortMode, string]>).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={sortMode === value ? "active" : ""}
                  onClick={() => setSortMode(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="search-box">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="CAN ID"
              />
            </label>
            <button type="button" onClick={() => setPaused((value) => !value)}>
              {paused ? <Activity size={16} /> : <CirclePause size={16} />}
              {paused ? "Resume" : "Pause"}
            </button>
            <button type="button" onClick={clearView}>
              <Square size={16} />
              Clear
            </button>
          </div>

          <div className="frame-table-wrap">
            <table className="frame-table">
              <colgroup>
                <col className="col-bus" />
                <col className="col-id" />
                <col className="col-data" />
                <col className="col-last" />
                <col className="col-rate" />
                <col className="col-count" />
              </colgroup>
              <thead>
                <tr>
                  <th>Bus</th>
                  <th>ID</th>
                  <th>Data</th>
                  <th>Last</th>
                  <th>Hz</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {visibleFrames.map((frame) => {
                  return (
                    <tr
                      key={frame.rowKey}
                      className={selectedFrameId === frame.rowKey ? "selected" : ""}
                      onClick={() => setSelectedFrameId(frame.rowKey)}
                    >
                      <td>{frame.bus}</td>
                      <td>{frame.id}</td>
                      <td className="mono">{frame.data}</td>
                      <td>{frame.lastSeen}</td>
                      <td>
                        <div className="rate-cell">
                          <span>{frame.rateHz}</span>
                          <div className="rate-bar-track" aria-hidden="true">
                            <div
                              className="rate-bar-fill"
                              style={{
                                width: `${rateBarWidthPercent(frame.rateHz, maxVisibleRateHz)}%`,
                              }}
                            />
                          </div>
                        </div>
                      </td>
                      <td>{frame.count.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visibleFrames.length === 0 ? <p className="empty-table">No frames</p> : null}
          </div>
        </section>
      </section>

      <section className="detail-panel" aria-label="frame detail">
        <div className="panel-heading">
          <Database size={18} />
          <h2>Detail</h2>
        </div>
        {selectedFrame ? (
          <>
            <div className="detail-grid">
              <div>
                <span>Frame</span>
                <strong>
                  {selectedFrame.bus} {selectedFrame.id}
                </strong>
              </div>
              <div>
                <span>Payload</span>
                <strong className="mono">{selectedFrame.data}</strong>
              </div>
              <div>
                <span>Metadata</span>
                <strong>
                  {selectedFrame.frameFormat} / DLC {selectedFrame.dlc} / {selectedFrame.length}{" "}
                  byte
                </strong>
              </div>
              <div>
                <span>Raw line</span>
                <strong className="mono">{selectedFrame.raw || "-"}</strong>
              </div>
            </div>
            {selectedFrame.mergedDetails && selectedFrame.mergedDetails.length > 1 ? (
              <div className="merged-detail-list">
                {selectedFrame.mergedDetails.map((detail) => (
                  <div className="merged-detail-row" key={detail.bus}>
                    <strong>{detail.bus}</strong>
                    <span className="mono">{detail.data || "-"}</span>
                    <span>{detail.rateHz} Hz</span>
                    <span>{detail.count.toLocaleString()}</span>
                    <span className="mono">{detail.raw || "-"}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <p className="empty-detail">Select a frame</p>
        )}
      </section>
        </>
      ) : null}

      {workspaceView === "parser" ? (
        <section className="parser-workspace" aria-label="parser workspace">
          <aside className="workspace-side-panel">
            <div className="panel-heading">
              <FileJson size={18} />
              <h2>Parse Config</h2>
            </div>
            <div className="config-summary">
              <span>{parseConfigName}</span>
              <strong>{parserSignals.length} signals</strong>
            </div>
            <div className="config-metrics">
              <div>
                <span>Parsed</span>
                <strong>{signalSamples.length}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{parsePreviewStatus}</strong>
              </div>
            </div>
            <label className="path-input">
              Config path
              <input
                value={parseConfigPath}
                onChange={(event) => setParseConfigPath(event.target.value)}
              />
            </label>
            <label className="path-input">
              Capture CSV
              <input
                value={capturePreviewPath}
                onChange={(event) => setCapturePreviewPath(event.target.value)}
              />
            </label>
            <div className="stacked-actions">
              <button type="button" title="パース設定JSONを読み込み" onClick={loadParseConfig}>
                <FileJson size={16} />
                Load
              </button>
              <button
                type="button"
                title="現在の受信データをパース"
                onClick={() => refreshParsePlotPreview()}
              >
                <RefreshCw size={16} />
                Parse
              </button>
              <button
                type="button"
                title="Capture CSVをパースしてプロット"
                onClick={refreshCaptureFilePreview}
              >
                <LineChart size={16} />
                CSV Plot
              </button>
            </div>
            <div className="signal-list">
              {parserSignals.map((signal) => (
                <button
                  type="button"
                  key={signal.id}
                  className={selectedSignalId === signal.id ? "selected" : ""}
                  onClick={() => setSelectedSignalId(signal.id)}
                >
                  <span>{signal.name}</span>
                  <strong>
                    {signal.bus} {signal.canId} / {signal.dataType}
                  </strong>
                </button>
              ))}
            </div>
          </aside>

          <section className="workspace-main-panel">
            <div className="panel-heading">
              <SlidersHorizontal size={18} />
              <h2>Signal Editor</h2>
            </div>
            <div className="workspace-summary">
              <div>
                <span>Selected samples</span>
                <strong>{selectedSignalSamples.length}</strong>
              </div>
              <div>
                <span>Source</span>
                <strong>
                  {selectedSignal.bus} {selectedSignal.canId}
                </strong>
              </div>
              <div>
                <span>Type</span>
                <strong>{selectedSignal.dataType}</strong>
              </div>
            </div>
            <div className="editor-grid">
              <label>
                Signal ID
                <input value={selectedSignal.id} readOnly />
              </label>
              <label>
                Name
                <input value={selectedSignal.name} readOnly />
              </label>
              <label>
                Bus
                <select value={selectedSignal.bus} disabled>
                  <option>{selectedSignal.bus}</option>
                </select>
              </label>
              <label>
                CAN ID
                <input value={selectedSignal.canId} readOnly />
              </label>
              <label>
                Type
                <input value={selectedSignal.dataType} readOnly />
              </label>
              <label>
                Byte
                <input value={selectedSignal.byteOffset} readOnly />
              </label>
              <label>
                Bit
                <input value={selectedSignal.bitOffset} readOnly />
              </label>
              <label>
                Length
                <input value={selectedSignal.bitLength} readOnly />
              </label>
              <label>
                Endian
                <select value={selectedSignal.endian} disabled>
                  <option value="little">little</option>
                  <option value="big">big</option>
                </select>
              </label>
              <label className="checkbox-line editor-checkbox">
                <input type="checkbox" checked={selectedSignal.signed} readOnly />
                Signed
              </label>
              <label>
                Scale
                <input value={selectedSignal.scale} readOnly />
              </label>
              <label>
                Offset
                <input value={selectedSignal.offset} readOnly />
              </label>
              <label>
                Unit
                <input value={selectedSignal.unit} readOnly />
              </label>
            </div>

            <div className="preview-table-wrap">
              <table className="preview-table">
                <thead>
                  <tr>
                    <th>timestamp</th>
                    <th>bus</th>
                    <th>frame</th>
                    <th>signal</th>
                    <th>value</th>
                    <th>unit</th>
                    <th>quality</th>
                  </tr>
                </thead>
                <tbody>
                  {(signalSamples.length > 0
                    ? signalSamples
                    : parserSignals.map((signal, index) => ({
                        timestamp_host: `+${(index * 0.5).toFixed(3)}s`,
                        bus: signal.bus,
                        frame_id: signal.canId,
                        signal_id: signal.id,
                        value: sampleSignalValue(signal, index),
                        unit: signal.unit,
                        quality: "preview",
                      }))
                  ).map((sample, index) => (
                    <tr key={`${sample.signal_id}-${index}`}>
                      <td>{sample.timestamp_host}</td>
                      <td>{sample.bus}</td>
                      <td className="mono">{sample.frame_id}</td>
                      <td>{sample.signal_id}</td>
                      <td className="mono">{sample.value.toFixed(3)}</td>
                      <td>{sample.unit}</td>
                      <td>{sample.quality}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      ) : null}

      {workspaceView === "plotter" ? (
        <section className="plotter-workspace" aria-label="plotter workspace">
          <aside className="workspace-side-panel">
            <div className="panel-heading">
              <LineChart size={18} />
              <h2>Plot Layout</h2>
            </div>
            <div className="config-summary">
              <span>{plotLayoutName}</span>
              <strong>{plotSeries.length} series</strong>
            </div>
            <div className="config-metrics">
              <div>
                <span>Points</span>
                <strong>{visiblePlotPoints.length}</strong>
              </div>
              <div>
                <span>Live</span>
                <strong>{realtimePlot ? "running" : "stopped"}</strong>
              </div>
            </div>
            <label className="path-input">
              Layout path
              <input
                value={plotLayoutPath}
                onChange={(event) => setPlotLayoutPath(event.target.value)}
              />
            </label>
            <label className="path-input">
              Capture CSV
              <input
                value={capturePreviewPath}
                onChange={(event) => setCapturePreviewPath(event.target.value)}
              />
            </label>
            <div className="stacked-actions">
              <button type="button" title="プロットレイアウトJSONを読み込み" onClick={loadPlotLayout}>
                <FileJson size={16} />
                Load
              </button>
              <button
                type="button"
                title="現在の受信データからプロットを生成"
                onClick={() => refreshParsePlotPreview()}
              >
                <RefreshCw size={16} />
                Plot
              </button>
              <button
                type="button"
                title="Capture CSVをパースしてプロット"
                onClick={refreshCaptureFilePreview}
              >
                <LineChart size={16} />
                CSV Plot
              </button>
              <button
                type="button"
                title="リアルタイムプロット更新"
                onClick={toggleRealtimePlot}
              >
                {realtimePlot ? <CirclePause size={16} /> : <Activity size={16} />}
                {realtimePlot ? "Stop" : "Live"}
              </button>
            </div>
            <button
              type="button"
              className="wide-action"
              title="プロット履歴をクリア"
              onClick={() => {
                setSignalSamples([]);
                setPlotPoints([]);
                signalSampleKeysRef.current.clear();
                plotPointKeysRef.current.clear();
                setParsePreviewStatus("cleared");
              }}
            >
              <Square size={16} />
              Clear Plot
            </button>
            <div className="signal-list">
              {plotSeries.map((series) => (
                <button
                  type="button"
                  key={series.id}
                  className={selectedSeriesId === series.id ? "selected" : ""}
                  onClick={() => setSelectedSeriesId(series.id)}
                >
                  <span>{series.label}</span>
                  <strong>
                    {series.panelId} / {series.signalId}
                  </strong>
                </button>
              ))}
            </div>
          </aside>

          <section className="workspace-main-panel">
            <div className="panel-heading">
              <SlidersHorizontal size={18} />
              <h2>Series Editor</h2>
            </div>
            <div className="workspace-summary">
              <div>
                <span>Selected points</span>
                <strong>{selectedSeriesPoints.length}</strong>
              </div>
              <div>
                <span>Panel</span>
                <strong>{selectedSeries.panelTitle}</strong>
              </div>
              <div>
                <span>Signal</span>
                <strong>{selectedSeries.signalId}</strong>
              </div>
            </div>
            <div className="editor-grid plot-editor-grid">
              <label>
                Series ID
                <input value={selectedSeries.id} readOnly />
              </label>
              <label>
                Panel
                <input value={selectedSeries.panelTitle} readOnly />
              </label>
              <label>
                Source signal
                <input value={selectedSeries.signalId} readOnly />
              </label>
              <label>
                Label
                <input value={selectedSeries.label} readOnly />
              </label>
              <label>
                Axis
                <select value={selectedSeries.axis} disabled>
                  <option value="left">left</option>
                  <option value="right">right</option>
                </select>
              </label>
              <label>
                Scale
                <input value={selectedSeries.scale} readOnly />
              </label>
              <label>
                Offset
                <input value={selectedSeries.offset} readOnly />
              </label>
              <label>
                Unit override
                <input value={selectedSeries.unit} readOnly />
              </label>
              <label>
                Color
                <input value={selectedSeries.color} readOnly />
              </label>
            </div>

            <div className="plot-preview">
              <div className="plot-preview-header">
                <strong>{selectedPanelTitle}</strong>
                <span>
                  last {plotVisibleWindowSeconds}s / {visiblePlotPoints.length} point(s)
                </span>
              </div>
              <canvas ref={plotCanvasRef} role="img" aria-label="plot preview" />
              <div className="plot-legend">
                {plotSeries.map((series) => (
                  <button
                    type="button"
                    key={series.id}
                    className={selectedSeriesId === series.id ? "selected" : ""}
                    onClick={() => setSelectedSeriesId(series.id)}
                  >
                    <span style={{ background: series.color }} />
                    {series.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="preview-table-wrap">
              <table className="preview-table">
                <thead>
                  <tr>
                    <th>timestamp</th>
                    <th>panel</th>
                    <th>series</th>
                    <th>signal</th>
                    <th>value</th>
                    <th>unit</th>
                  </tr>
                </thead>
                <tbody>
                  {plotPointRows.map((point, index) => (
                    <tr key={`${point.panel_id}-${point.series_id}-${index}`}>
                      <td>{point.timestamp_host}</td>
                      <td>{point.panel_id}</td>
                      <td>{point.series_id}</td>
                      <td>{point.source_signal_id}</td>
                      <td className="mono">{point.value.toFixed(3)}</td>
                      <td>{point.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {plotPoints.length === 0 ? <p className="empty-table">No plot points</p> : null}
            </div>
          </section>
        </section>
      ) : null}

      <footer className="status-strip">
        <span>{eventLog}</span>
        <span>{paused ? "display paused" : connected ? "receiving" : "display live"}</span>
      </footer>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
