import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import {
  Activity,
  Cable,
  CirclePause,
  Database,
  Download,
  Plug,
  RefreshCw,
  Search,
  Square,
  Unplug,
} from "lucide-react";
import "./styles.css";

type SerialPortInfo = {
  port_name: string;
  port_type: string;
};

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

type BusConfig = {
  bus: "CAN0" | "CAN1";
  port: string;
  bitrate: string;
  dataBitrate: string;
  listenOnly: boolean;
  status: "idle" | "ready" | "connecting" | "connected" | "error";
  frames: number;
  errors: number;
};

type LatestFrame = {
  bus: string;
  id: string;
  idFormat: string;
  frameFormat: string;
  frameType: string;
  dlc: number;
  length: number;
  data: string;
  flags: string;
  lastSeen: string;
  rateHz: string;
  count: number;
  raw: string;
};

type BusStatusDto = {
  bus: string;
  status: BusConfig["status"] | "connecting";
  frames: number;
  errors: number;
  message: string;
};

type LatestFrameDto = {
  bus: string;
  id: string;
  id_format: string;
  frame_format: string;
  frame_type: string;
  dlc: number;
  length: number;
  data: string;
  flags: string;
  last_seen: string;
  rate_hz: string;
  count: number;
  raw: string;
};

type SnapshotDto = {
  buses: BusStatusDto[];
  frames: LatestFrameDto[];
  event_log: string;
};

const initialBuses: BusConfig[] = [
  {
    bus: "CAN0",
    port: "COM3",
    bitrate: "S8",
    dataBitrate: "Y2",
    listenOnly: true,
    status: "idle",
    frames: 0,
    errors: 0,
  },
  {
    bus: "CAN1",
    port: "COM85",
    bitrate: "S8",
    dataBitrate: "Y2",
    listenOnly: true,
    status: "idle",
    frames: 0,
    errors: 0,
  },
];

const previewPorts: SerialPortInfo[] = [
  {
    port_name: "COM3",
    port_type: "WeActStudio USB2CANFDV1 preview",
  },
  {
    port_name: "COM85",
    port_type: "WeActStudio USB2CANFDV1 preview",
  },
];

const sampleFrames: LatestFrame[] = [
  {
    bus: "CAN0",
    id: "0x103",
    idFormat: "standard",
    frameFormat: "classic",
    frameType: "data",
    dlc: 8,
    length: 8,
    data: "0000000000000000",
    flags: "",
    lastSeen: "停止中",
    rateHz: "-",
    count: 0,
    raw: "",
  },
  {
    bus: "CAN1",
    id: "0x110",
    idFormat: "standard",
    frameFormat: "classic",
    frameType: "data",
    dlc: 8,
    length: 8,
    data: "0101C80000000000",
    flags: "",
    lastSeen: "停止中",
    rateHz: "-",
    count: 0,
    raw: "",
  },
];

function hasTauriRuntime() {
  return Boolean(window.__TAURI_INTERNALS__);
}

function mapSnapshotFrame(frame: LatestFrameDto): LatestFrame {
  return {
    bus: frame.bus,
    id: frame.id,
    idFormat: frame.id_format,
    frameFormat: frame.frame_format,
    frameType: frame.frame_type,
    dlc: frame.dlc,
    length: frame.length,
    data: frame.data,
    flags: frame.flags,
    lastSeen: frame.last_seen,
    rateHz: frame.rate_hz,
    count: frame.count,
    raw: frame.raw,
  };
}

function App() {
  const [ports, setPorts] = React.useState<SerialPortInfo[]>([]);
  const [buses, setBuses] = React.useState(initialBuses);
  const [frames, setFrames] = React.useState(sampleFrames);
  const [selectedFrameId, setSelectedFrameId] = React.useState("CAN0-0x103");
  const [busFilter, setBusFilter] = React.useState("ALL");
  const [query, setQuery] = React.useState("");
  const [paused, setPaused] = React.useState(false);
  const [connected, setConnected] = React.useState(false);
  const [eventLog, setEventLog] = React.useState("GUI skeleton ready");

  const selectedFrame =
    frames.find((frame) => `${frame.bus}-${frame.id}` === selectedFrameId) ?? frames[0];

  const visibleFrames = frames.filter((frame) => {
    const busMatches = busFilter === "ALL" || frame.bus === busFilter;
    const queryMatches = frame.id.toLowerCase().includes(query.toLowerCase());
    return busMatches && queryMatches;
  });

  async function refreshPorts() {
    try {
      const listed = window.__TAURI_INTERNALS__
        ? await invoke<SerialPortInfo[]>("list_serial_ports")
        : previewPorts;
      setPorts(listed);
      setEventLog(
        hasTauriRuntime()
          ? `${listed.length} serial port(s) detected`
          : "browser preview mode; using sample serial ports",
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

  async function connectAll() {
    if (!hasTauriRuntime()) {
      setConnected(true);
      setBuses((current) =>
        current.map((bus) => ({
          ...bus,
          status: bus.port ? "connected" : "error",
          frames: bus.port ? bus.frames : 0,
          errors: bus.port ? bus.errors : bus.errors + 1,
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
        await invoke("connect_bus", {
          config: {
            bus: bus.bus,
            port: bus.port,
            bitrate: bus.bitrate,
            data_bitrate: bus.dataBitrate,
            listen_only: bus.listenOnly,
          },
        });
      }
      setConnected(true);
      setEventLog("all buses connecting");
    } catch (error) {
      setEventLog(`connect failed: ${String(error)}`);
    }
  }

  async function disconnectAll() {
    if (hasTauriRuntime()) {
      try {
        await invoke("disconnect_all");
      } catch (error) {
        setEventLog(`disconnect failed: ${String(error)}`);
        return;
      }
    }
    setConnected(false);
    setBuses((current) => current.map((bus) => ({ ...bus, status: "ready" })));
    setEventLog("all buses disconnected");
  }

  async function clearView() {
    if (hasTauriRuntime()) {
      try {
        await invoke("clear_latest");
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
  }, []);

  React.useEffect(() => {
    if (!hasTauriRuntime()) {
      return undefined;
    }

    const timer = window.setInterval(async () => {
      try {
        const snapshot = await invoke<SnapshotDto>("latest_snapshot");
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
            };
          }),
        );
        if (!paused) {
          const nextFrames = snapshot.frames.map(mapSnapshotFrame);
          setFrames(nextFrames);
          if (nextFrames.length > 0) {
            const selectedExists = nextFrames.some(
              (frame) => `${frame.bus}-${frame.id}` === selectedFrameId,
            );
            if (!selectedExists) {
              setSelectedFrameId(`${nextFrames[0].bus}-${nextFrames[0].id}`);
            }
          }
        }
        if (snapshot.event_log) {
          setEventLog(snapshot.event_log);
        }
      } catch (error) {
        setEventLog(`snapshot failed: ${String(error)}`);
      }
    }, 200);

    return () => window.clearInterval(timer);
  }, [paused, selectedFrameId]);

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <h1>CANRush</h1>
          <p>受信専用モニタ skeleton</p>
        </div>
        <div className="toolbar" aria-label="main actions">
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
          <button type="button" title="CSV キャプチャ">
            <Download size={16} />
            Capture CSV
          </button>
        </div>
      </header>

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
            <button
              type="button"
              onClick={clearView}
            >
              <Square size={16} />
              Clear
            </button>
          </div>

          <div className="frame-table-wrap">
            <table className="frame-table">
              <thead>
                <tr>
                  <th>Bus</th>
                  <th>ID</th>
                  <th>ID fmt</th>
                  <th>Frame</th>
                  <th>DLC</th>
                  <th>Len</th>
                  <th>Data</th>
                  <th>Flags</th>
                  <th>Last</th>
                  <th>Hz</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {visibleFrames.map((frame) => {
                  const rowId = `${frame.bus}-${frame.id}`;
                  return (
                    <tr
                      key={rowId}
                      className={selectedFrameId === rowId ? "selected" : ""}
                      onClick={() => setSelectedFrameId(rowId)}
                    >
                      <td>{frame.bus}</td>
                      <td>{frame.id}</td>
                      <td>{frame.idFormat}</td>
                      <td>{frame.frameFormat}</td>
                      <td>{frame.dlc}</td>
                      <td>{frame.length}</td>
                      <td className="mono">{frame.data}</td>
                      <td>{frame.flags || "-"}</td>
                      <td>{frame.lastSeen}</td>
                      <td>{frame.rateHz}</td>
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
                {selectedFrame.frameFormat} / DLC {selectedFrame.dlc} / {selectedFrame.length} byte
              </strong>
            </div>
            <div>
              <span>Raw line</span>
              <strong className="mono">{selectedFrame.raw || "-"}</strong>
            </div>
          </div>
        ) : (
          <p className="empty-detail">Select a frame</p>
        )}
      </section>

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
