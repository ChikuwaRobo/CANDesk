import { Activity, CirclePause, FileJson, LineChart, RefreshCw, SlidersHorizontal, Square } from "lucide-react";
import type { RefObject } from "react";
import type { PlotPointDto, PlotSeries } from "../types";

type CurrentPlotValue = {
  series: PlotSeries;
  latestPoint?: PlotPointDto;
};

type PlotPerformance = {
  liveRequestMs: number;
  livePoints: number;
  canvasDrawMs: number;
  canvasPoints: number;
  canvasRawPoints: number;
  decimationMs: number;
};

type PlotterViewProps = {
  plotLayoutName: string;
  plotLayoutPath: string;
  capturePreviewPath: string;
  plotSeries: PlotSeries[];
  selectedSeries: PlotSeries;
  selectedSeriesId: string;
  visibleSeriesIds: string[];
  selectedSeriesPoints: PlotPointDto[];
  selectedPanelTitle: string;
  visiblePlotPoints: PlotPointDto[];
  currentPlotValues: CurrentPlotValue[];
  hasPlotPoints: boolean;
  plotPerformance: PlotPerformance;
  signalSampleCount: number;
  parsePreviewStatus: string;
  realtimePlot: boolean;
  plotVisibleWindowSeconds: number;
  plotCanvasRef: RefObject<HTMLCanvasElement>;
  onPlotLayoutPathChange: (value: string) => void;
  onCapturePreviewPathChange: (value: string) => void;
  onLoadPlotLayout: () => void;
  onRefreshParsePlotPreview: () => void;
  onRefreshCaptureFilePreview: () => void;
  onToggleRealtimePlot: () => void;
  onClearPlot: () => void;
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
  selectedSeriesPoints,
  selectedPanelTitle,
  visiblePlotPoints,
  currentPlotValues,
  hasPlotPoints,
  plotPerformance,
  signalSampleCount,
  parsePreviewStatus,
  realtimePlot,
  plotVisibleWindowSeconds,
  plotCanvasRef,
  onPlotLayoutPathChange,
  onCapturePreviewPathChange,
  onLoadPlotLayout,
  onRefreshParsePlotPreview,
  onRefreshCaptureFilePreview,
  onToggleRealtimePlot,
  onClearPlot,
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
            <span>Points</span>
            <strong>{visiblePlotPoints.length}</strong>
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
            <span>Live</span>
            <strong>{realtimePlot ? "running" : "stopped"}</strong>
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
          <button type="button" title="プロットレイアウトJSONを読み込み" onClick={onLoadPlotLayout}>
            <FileJson size={16} />
            Load
          </button>
          <button type="button" title="現在の受信データからプロットを生成" onClick={onRefreshParsePlotPreview}>
            <RefreshCw size={16} />
            Plot
          </button>
          <button type="button" title="Capture CSVをパースしてプロット" onClick={onRefreshCaptureFilePreview}>
            <LineChart size={16} />
            CSV Plot
          </button>
          <button type="button" title="リアルタイムプロット更新" onClick={onToggleRealtimePlot}>
            {realtimePlot ? <CirclePause size={16} /> : <Activity size={16} />}
            {realtimePlot ? "Stop" : "Live"}
          </button>
        </div>
        <button type="button" className="wide-action" title="プロット履歴をクリア" onClick={onClearPlot}>
          <Square size={16} />
          Clear Plot
        </button>
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
                onClick={() => onSelectedSeriesChange(series.id)}
              >
                <span style={{ background: series.color }} />
                {series.label}
              </button>
            ))}
          </div>
        </div>
        <div className="current-values-panel">
          <div className="panel-heading compact-heading">
            <Activity size={16} />
            <h3>Current Values</h3>
          </div>
          <div className="current-values-grid">
            {currentPlotValues.map(({ series, latestPoint }) => (
              <div className="current-value-card" key={series.id}>
                <span style={{ borderColor: series.color }}>{series.label}</span>
                <strong>{latestPoint ? latestPoint.value.toFixed(3) : "-"}</strong>
                <small>
                  {latestPoint?.unit || series.unit || "-"} / {latestPoint?.timestamp_host ?? "-"}
                </small>
              </div>
            ))}
          </div>
          {!hasPlotPoints ? <p className="empty-table">No plot points</p> : null}
        </div>
        <div className="plot-performance-panel">
          <span>Live request {plotPerformance.liveRequestMs.toFixed(1)}ms</span>
          <span>Live points {plotPerformance.livePoints}</span>
          <span>Raw points {plotPerformance.canvasRawPoints}</span>
          <span>Drawable {plotPerformance.canvasPoints}</span>
          <span>Decimate {plotPerformance.decimationMs.toFixed(1)}ms</span>
          <span>Canvas draw {plotPerformance.canvasDrawMs.toFixed(1)}ms</span>
        </div>
      </section>
    </section>
  );
}
