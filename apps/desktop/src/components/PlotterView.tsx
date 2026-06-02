import { FileJson, LineChart, SlidersHorizontal } from "lucide-react";
import type { PlotSeries } from "../types";

type PlotterViewProps = {
  plotLayoutName: string;
  plotLayoutPath: string;
  capturePreviewPath: string;
  plotSeries: PlotSeries[];
  selectedSeries: PlotSeries;
  selectedSeriesId: string;
  visibleSeriesIds: string[];
  signalSampleCount: number;
  parsePreviewStatus: string;
  onPlotLayoutPathChange: (value: string) => void;
  onCapturePreviewPathChange: (value: string) => void;
  onLoadPlotLayout: () => void;
  onSelectedSeriesChange: (id: string) => void;
  onVisibleSeriesToggle: (id: string) => void;
};

export function PlotterView({
  plotLayoutName,
  plotLayoutPath,
  capturePreviewPath,
  plotSeries,
  selectedSeries,
  selectedSeriesId,
  visibleSeriesIds,
  signalSampleCount,
  parsePreviewStatus,
  onPlotLayoutPathChange,
  onCapturePreviewPathChange,
  onLoadPlotLayout,
  onSelectedSeriesChange,
  onVisibleSeriesToggle,
}: PlotterViewProps) {
  return (
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
            <span>Series</span>
            <strong>{plotSeries.length}</strong>
          </div>
          <div>
            <span>Samples</span>
            <strong>{signalSampleCount}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{parsePreviewStatus}</strong>
          </div>
          <div>
            <span>Selected</span>
            <strong>{selectedSeries.label}</strong>
          </div>
        </div>
        <label className="path-input">
          Layout path
          <input value={plotLayoutPath} onChange={(event) => onPlotLayoutPathChange(event.target.value)} />
        </label>
        <label className="path-input">
          Capture CSV
          <input
            value={capturePreviewPath}
            onChange={(event) => onCapturePreviewPathChange(event.target.value)}
          />
        </label>
        <div className="stacked-actions">
          <button type="button" title="Plot layout JSON を読み込み" onClick={onLoadPlotLayout}>
            <FileJson size={16} />
            Load
          </button>
        </div>
        <div className="signal-list">
          {plotSeries.map((series) => (
            <div
              key={series.id}
              className={`series-list-row${selectedSeriesId === series.id ? " selected" : ""}`}
            >
              <label className="series-visibility">
                <input
                  type="checkbox"
                  checked={visibleSeriesIds.includes(series.id)}
                  onChange={() => onVisibleSeriesToggle(series.id)}
                />
                <span />
              </label>
              <button type="button" onClick={() => onSelectedSeriesChange(series.id)}>
                <span>{series.label}</span>
                <strong>
                  {series.panelId} / {series.signalId}
                </strong>
              </button>
            </div>
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
            <span>Series</span>
            <strong>{selectedSeries.label}</strong>
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
      </section>
    </section>
  );
}
