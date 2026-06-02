import { Check, ChevronDown, LineChart, Radio } from "lucide-react";
import { plotColorPalette } from "../lib/plotColors";
import type { PlotPointDto, PlotSeries, PlotterPerfStats, SignalSampleDto } from "../types";
import { UPlotLiveChart } from "./UPlotLiveChart";

type CurrentValue = {
  series: PlotSeries;
  sample?: SignalSampleDto;
};

type PlotterViewProps = {
  plotLayoutName: string;
  plotLayoutPath: string;
  plotSeries: PlotSeries[];
  selectedSeriesId: string;
  visibleSeriesIds: string[];
  currentValues: CurrentValue[];
  plotPoints: PlotPointDto[];
  plotDataVersion: number;
  valuesRunning: boolean;
  perfStats: PlotterPerfStats | null;
  signalSampleCount: number;
  parsePreviewStatus: string;
  onPlotLayoutPathChange: (value: string) => void;
  onSelectedSeriesChange: (id: string) => void;
  onVisibleSeriesToggle: (id: string) => void;
  onSeriesColorChange: (id: string, color: string) => void;
  onPlotFrameMeasured: (durationMs: number) => void;
};

export function PlotterView({
  plotLayoutName,
  plotLayoutPath,
  plotSeries,
  selectedSeriesId,
  visibleSeriesIds,
  currentValues,
  plotPoints,
  plotDataVersion,
  valuesRunning,
  perfStats,
  signalSampleCount,
  parsePreviewStatus,
  onPlotLayoutPathChange,
  onSelectedSeriesChange,
  onVisibleSeriesToggle,
  onSeriesColorChange,
  onPlotFrameMeasured,
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
            <span>Samples</span>
            <strong>{signalSampleCount}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{valuesRunning ? parsePreviewStatus : "starting"}</strong>
          </div>
        </div>
        {perfStats ? (
          <div className="plotter-perf-metrics" aria-label="plotter performance">
            <div>
              <span>Poll</span>
              <strong>{perfStats.pollIntervalMs.toFixed(1)} ms</strong>
            </div>
            <div>
              <span>API</span>
              <strong>{perfStats.apiMs.toFixed(1)} ms</strong>
            </div>
            <div>
              <span>Rust</span>
              <strong>{perfStats.rustTotalMs.toFixed(1)} ms</strong>
            </div>
            <div>
              <span>Lock</span>
              <strong>{perfStats.rustLockMs.toFixed(1)} ms</strong>
            </div>
            <div>
              <span>Parse</span>
              <strong>{perfStats.rustParseMs.toFixed(1)} ms</strong>
            </div>
            <div>
              <span>Points</span>
              <strong>{perfStats.rustBuildPointsMs.toFixed(1)} ms</strong>
            </div>
            <div>
              <span>Frames</span>
              <strong>{perfStats.rustFrames.toFixed(1)}</strong>
            </div>
            <div>
              <span>Commit</span>
              <strong>{perfStats.commitMs.toFixed(1)} ms</strong>
            </div>
            <div>
              <span>Samples</span>
              <strong>{perfStats.samplesPerPoll.toFixed(1)}</strong>
            </div>
            <div>
              <span>FPS</span>
              <strong>{perfStats.renderFps.toFixed(1)}</strong>
            </div>
            <div>
              <span>Plot</span>
              <strong>{perfStats.plotFrameMs.toFixed(1)} ms</strong>
            </div>
            <div>
              <span>Dropped</span>
              <strong>{perfStats.droppedFrames}</strong>
            </div>
          </div>
        ) : null}

        <section className="plot-settings-section">
          <h3>General</h3>
          <label className="path-input">
            Layout path
            <input value={plotLayoutPath} onChange={(event) => onPlotLayoutPathChange(event.target.value)} />
          </label>
        </section>

        <section className="plot-settings-section">
          <h3>Legend</h3>
          <label className="setting-row compact-check-row">
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
                  <strong>{series.signalId}</strong>
                </button>
                <details className="series-color-menu">
                  <summary aria-label={`${series.label} color`}>
                    <span style={{ background: series.color }} />
                    <ChevronDown size={14} />
                  </summary>
                  <div className="series-color-options">
                    {plotColorPalette.map((color) => (
                      <button
                        aria-label={`${series.label} ${color}`}
                        key={color}
                        type="button"
                        onClick={() => onSeriesColorChange(series.id, color)}
                      >
                        <span style={{ background: color }} />
                        {series.color === color ? <Check size={14} /> : null}
                      </button>
                    ))}
                  </div>
                </details>
              </div>
            ))}
          </div>
        </section>
      </aside>

      <section className="workspace-main-panel">
        <section className="plot-display-panel">
          <div className="panel-heading">
            <LineChart size={18} />
            <h2>Live Plot</h2>
          </div>
          <UPlotLiveChart
            plotSeries={plotSeries}
            visibleSeriesIds={visibleSeriesIds}
            points={plotPoints}
            dataVersion={plotDataVersion}
            showLegend
            onFrameMeasured={onPlotFrameMeasured}
          />
        </section>
        <div className="panel-heading current-values-heading">
          <Radio size={18} />
          <h2>Current Values</h2>
        </div>
        <div className="current-value-list">
          {currentValues.map(({ series, sample }) => (
            <div className="current-value-row" key={series.id}>
              <span className="series-color-chip" style={{ background: series.color }} />
              <div>
                <strong>{series.label}</strong>
                <small>{series.signalId}</small>
              </div>
              <output>{sample ? sample.value.toFixed(3) : "-"}</output>
              <span>{sample?.unit || series.unit || "-"}</span>
              <time>{sample?.timestamp_host ?? "-"}</time>
            </div>
          ))}
          {currentValues.length === 0 ? <p className="empty-detail">No selected data</p> : null}
        </div>
      </section>
    </section>
  );
}
