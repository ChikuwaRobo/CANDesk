import { Activity, CirclePause, Search, Square } from "lucide-react";
import { rateBarWidthPercent } from "../lib/frames";
import type { LatestFrame, SortMode } from "../types";

type FrameTableProps = {
  visibleFrames: LatestFrame[];
  selectedFrameId: string;
  busFilter: string;
  mergeBuses: boolean;
  debugDummy: boolean;
  sortMode: SortMode;
  query: string;
  paused: boolean;
  maxVisibleRateHz: number;
  onBusFilterChange: (value: string) => void;
  onMergeBusesChange: (value: boolean) => void;
  onDebugDummyChange: (value: boolean) => void;
  onSortModeChange: (value: SortMode) => void;
  onQueryChange: (value: string) => void;
  onTogglePaused: () => void;
  onClearView: () => void;
  onSelectedFrameChange: (rowKey: string) => void;
};

export function FrameTable({
  visibleFrames,
  selectedFrameId,
  busFilter,
  mergeBuses,
  debugDummy,
  sortMode,
  query,
  paused,
  maxVisibleRateHz,
  onBusFilterChange,
  onMergeBusesChange,
  onDebugDummyChange,
  onSortModeChange,
  onQueryChange,
  onTogglePaused,
  onClearView,
  onSelectedFrameChange,
}: FrameTableProps) {
  return (
    <section className="table-panel" aria-label="latest frames">
      <div className="table-tools">
        <div className="segmented" role="group" aria-label="bus filter">
          {["ALL", "CAN0", "CAN1"].map((value) => (
            <button
              type="button"
              key={value}
              className={busFilter === value ? "active" : ""}
              onClick={() => onBusFilterChange(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <label className="checkbox-line table-toggle">
          <input
            type="checkbox"
            checked={mergeBuses}
            onChange={(event) => onMergeBusesChange(event.target.checked)}
          />
          Merge buses
        </label>
        <label className="checkbox-line table-toggle">
          <input
            type="checkbox"
            checked={debugDummy}
            onChange={(event) => onDebugDummyChange(event.target.checked)}
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
              onClick={() => onSortModeChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="search-box">
          <Search size={16} />
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="CAN ID" />
        </label>
        <button type="button" onClick={onTogglePaused}>
          {paused ? <Activity size={16} /> : <CirclePause size={16} />}
          {paused ? "Resume" : "Pause"}
        </button>
        <button type="button" onClick={onClearView}>
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
            {visibleFrames.map((frame) => (
              <tr
                key={frame.rowKey}
                className={selectedFrameId === frame.rowKey ? "selected" : ""}
                onClick={() => onSelectedFrameChange(frame.rowKey)}
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
                        style={{ width: `${rateBarWidthPercent(frame.rateHz, maxVisibleRateHz)}%` }}
                      />
                    </div>
                  </div>
                </td>
                <td>{frame.count.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {visibleFrames.length === 0 ? <p className="empty-table">No frames</p> : null}
      </div>
    </section>
  );
}
