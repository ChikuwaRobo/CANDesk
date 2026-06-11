type StatusStripProps = {
  eventLog: string;
  paused: boolean;
  connected: boolean;
};

export function StatusStrip({ eventLog, paused, connected }: StatusStripProps) {
  const hasError = /failed|error|overflow|dropped|disconnected/i.test(eventLog);
  return (
    <footer className={`status-strip ${hasError ? "error" : ""}`}>
      <span role={hasError ? "alert" : undefined}>{eventLog}</span>
      <span>{paused ? "display paused" : connected ? "receiving" : "display live"}</span>
    </footer>
  );
}
