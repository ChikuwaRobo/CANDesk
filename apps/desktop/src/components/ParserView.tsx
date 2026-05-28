import { FileJson, LineChart, RefreshCw, SlidersHorizontal } from "lucide-react";
import { sampleSignalValue } from "../lib/parserMapping";
import type { ParserSignal, SignalSampleDto } from "../types";

type ParserViewProps = {
  parseConfigName: string;
  parseConfigPath: string;
  capturePreviewPath: string;
  parserSignals: ParserSignal[];
  selectedSignal: ParserSignal;
  selectedSignalId: string;
  selectedSignalSamples: SignalSampleDto[];
  signalSamples: SignalSampleDto[];
  parsePreviewStatus: string;
  onParseConfigPathChange: (value: string) => void;
  onCapturePreviewPathChange: (value: string) => void;
  onLoadParseConfig: () => void;
  onRefreshParsePlotPreview: () => void;
  onRefreshCaptureFilePreview: () => void;
  onSelectedSignalChange: (id: string) => void;
};

export function ParserView({
  parseConfigName,
  parseConfigPath,
  capturePreviewPath,
  parserSignals,
  selectedSignal,
  selectedSignalId,
  selectedSignalSamples,
  signalSamples,
  parsePreviewStatus,
  onParseConfigPathChange,
  onCapturePreviewPathChange,
  onLoadParseConfig,
  onRefreshParsePlotPreview,
  onRefreshCaptureFilePreview,
  onSelectedSignalChange,
}: ParserViewProps) {
  const tableSamples =
    signalSamples.length > 0
      ? signalSamples
      : parserSignals.map((signal, index) => ({
          timestamp_host: `+${(index * 0.5).toFixed(3)}s`,
          bus: signal.bus,
          frame_id: signal.canId,
          signal_id: signal.id,
          name: signal.name,
          value: sampleSignalValue(signal, index),
          unit: signal.unit,
          quality: "preview",
          source_sequence: index,
        }));

  return (
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
          <input value={parseConfigPath} onChange={(event) => onParseConfigPathChange(event.target.value)} />
        </label>
        <label className="path-input">
          Capture CSV
          <input
            value={capturePreviewPath}
            onChange={(event) => onCapturePreviewPathChange(event.target.value)}
          />
        </label>
        <div className="stacked-actions">
          <button type="button" title="パース設定JSONを読み込み" onClick={onLoadParseConfig}>
            <FileJson size={16} />
            Load
          </button>
          <button type="button" title="現在の受信データをパース" onClick={onRefreshParsePlotPreview}>
            <RefreshCw size={16} />
            Parse
          </button>
          <button type="button" title="Capture CSVをパースしてプロット" onClick={onRefreshCaptureFilePreview}>
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
              onClick={() => onSelectedSignalChange(signal.id)}
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
              {tableSamples.map((sample, index) => (
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
  );
}
