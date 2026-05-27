import { BusPanel } from "./BusPanel";
import { FrameDetail } from "./FrameDetail";
import { FrameTable } from "./FrameTable";
import type { BusConfig, LatestFrame, SerialPortInfo, SortMode } from "../types";

type MonitorViewProps = {
  buses: BusConfig[];
  ports: SerialPortInfo[];
  visibleFrames: LatestFrame[];
  selectedFrame: LatestFrame | undefined;
  selectedFrameId: string;
  busFilter: string;
  mergeBuses: boolean;
  debugDummy: boolean;
  sortMode: SortMode;
  query: string;
  paused: boolean;
  maxVisibleRateHz: number;
  onUpdateBus: (index: number, patch: Partial<BusConfig>) => void;
  onBusFilterChange: (value: string) => void;
  onMergeBusesChange: (value: boolean) => void;
  onDebugDummyChange: (value: boolean) => void;
  onSortModeChange: (value: SortMode) => void;
  onQueryChange: (value: string) => void;
  onTogglePaused: () => void;
  onClearView: () => void;
  onSelectedFrameChange: (rowKey: string) => void;
};

export function MonitorView({
  buses,
  ports,
  visibleFrames,
  selectedFrame,
  selectedFrameId,
  busFilter,
  mergeBuses,
  debugDummy,
  sortMode,
  query,
  paused,
  maxVisibleRateHz,
  onUpdateBus,
  onBusFilterChange,
  onMergeBusesChange,
  onDebugDummyChange,
  onSortModeChange,
  onQueryChange,
  onTogglePaused,
  onClearView,
  onSelectedFrameChange,
}: MonitorViewProps) {
  return (
    <>
      <section className="content-grid">
        <BusPanel buses={buses} ports={ports} onUpdateBus={onUpdateBus} />
        <FrameTable
          visibleFrames={visibleFrames}
          selectedFrameId={selectedFrameId}
          busFilter={busFilter}
          mergeBuses={mergeBuses}
          debugDummy={debugDummy}
          sortMode={sortMode}
          query={query}
          paused={paused}
          maxVisibleRateHz={maxVisibleRateHz}
          onBusFilterChange={onBusFilterChange}
          onMergeBusesChange={onMergeBusesChange}
          onDebugDummyChange={onDebugDummyChange}
          onSortModeChange={onSortModeChange}
          onQueryChange={onQueryChange}
          onTogglePaused={onTogglePaused}
          onClearView={onClearView}
          onSelectedFrameChange={onSelectedFrameChange}
        />
      </section>
      <FrameDetail selectedFrame={selectedFrame} />
    </>
  );
}
