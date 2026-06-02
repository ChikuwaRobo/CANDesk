import { FileJson, LineChart, SlidersHorizontal } from "lucide-react";
import type { PlotSeries } from "../types";

type PlotterViewProps = {
  plotLayoutName: string;
  plotLayoutPath: string;
  plotSeries: PlotSeries[];
  selectedSeries: PlotSeries;
  selectedSeriesId: string;
  visibleSeriesIds: string[];
  signalSampleCount: number;
  parsePreviewStatus: string;
  onPlotLayoutPathChange: (value: string) => void;
  onLoadPlotLayout: () => void;
  onSelectedSeriesChange: (id: string) => void;
  onVisibleSeriesToggle: (id: string) => void;
  onSeriesColorChange: (id: string, color: string) => void;
};

export function PlotterView({
  plotLayoutName,
  plotLayoutPath,
  plotSeries,
  selectedSeries,
  selectedSeriesId,
  visibleSeriesIds,
  signalSampleCount,
  parsePreviewStatus,
  onPlotLayoutPathChange,
  onLoadPlotLayout,
  onSelectedSeriesChange,
  onVisibleSeriesToggle,
  onSeriesColorChange,
}: PlotterViewProps) {
  return (
    <section className="plotter-workspace" aria-label="plotter workspace">
      <aside className="workspace-side-panel plot-settings-panel">
        <div className="panel-heading">
          <LineChart size={18} />
          <h2>Plot Settings</h2>
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
        </div>

        <section className="plot-settings-section">
          <h3>General</h3>
          <label className="path-input">
            Layout path
            <input value={plotLayoutPath} onChange={(event) => onPlotLayoutPathChange(event.target.value)} />
          </label>
          <div className="stacked-actions single-action">
            <button type="button" title="Plot layout JSON を読み込み" onClick={onLoadPlotLayout}>
              <FileJson size={16} />
              Load
            </button>
          </div>
        </section>

        <section className="plot-settings-section">
          <h3>Legend</h3>
          <label className="setting-row">
            Show legend
            <input type="checkbox" checked readOnly />
          </label>
          <label className="setting-row">
            Position
            <select value="floating" disabled>
              <option value="floating">floating</option>
            </select>
          </label>
        </section>

        <section className="plot-settings-section">
          <h3>X Axis</h3>
          <label className="setting-row">
            Value type
            <select value="timestamp" disabled>
              <option value="timestamp">timestamp</option>
            </select>
          </label>
          <label className="setting-row">
            Label
            <input value="" readOnly />
          </label>
        </section>

        <section className="plot-settings-section">
          <h3>Y Axis</h3>
          <label className="setting-row">
            Label
            <input value="" readOnly />
          </label>
          <label className="setting-row">
            Range
            <select value="auto" disabled>
              <option value="auto">auto</option>
            </select>
          </label>
        </section>

        <section className="plot-settings-section">
          <h3>Series</h3>
          <div className="signal-list plot-series-list">
            {plotSeries.map((series) => (
              <div
                key={series.id}
                className={`series-list-row plot-series-row${selectedSeriesId === series.id ? " selected" : ""}`}
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
                <label className="series-color-picker" title={`${series.label} color`}>
                  <span style={{ background: series.color }} />
                  <input
                    aria-label={`${series.label} color`}
                    type="color"
                    value={series.color}
                    onChange={(event) => onSeriesColorChange(series.id, event.target.value)}
                  />
                </label>
              </div>
            ))}
          </div>
        </section>
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
