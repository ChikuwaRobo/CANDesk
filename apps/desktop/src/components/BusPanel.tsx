import { Cable } from "lucide-react";
import type { BusConfig, SerialPortInfo } from "../types";

type BusPanelProps = {
  buses: BusConfig[];
  ports: SerialPortInfo[];
  onUpdateBus: (index: number, patch: Partial<BusConfig>) => void;
};

export function BusPanel({ buses, ports, onUpdateBus }: BusPanelProps) {
  return (
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
              onChange={(event) => onUpdateBus(index, { port: event.target.value })}
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
                onChange={(event) => onUpdateBus(index, { bitrate: event.target.value })}
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
                onChange={(event) => onUpdateBus(index, { dataBitrate: event.target.value })}
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
              onChange={(event) => onUpdateBus(index, { listenOnly: event.target.checked })}
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
          {bus.status === "error" || bus.message !== "receiving" ? (
            <p className={`bus-message ${bus.status === "error" ? "error" : ""}`}>
              {bus.message}
            </p>
          ) : null}
        </article>
      ))}
    </aside>
  );
}
