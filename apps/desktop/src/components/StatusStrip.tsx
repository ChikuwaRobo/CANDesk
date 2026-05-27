type StatusStripProps = {
  eventLog: string;
  paused: boolean;
  connected: boolean;
};

export function StatusStrip({ eventLog, paused, connected }: StatusStripProps) {
  return (
    <footer className="status-strip">
      <span>{eventLog}</span>
      <span>{paused ? "display paused" : connected ? "receiving" : "display live"}</span>
    </footer>
  );
}
