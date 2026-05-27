import React from "react";

type UseRealtimePlotInput = {
  enabled: boolean;
  intervalMs: number;
  refresh: () => Promise<void>;
};

export function useRealtimePlot({ enabled, intervalMs, refresh }: UseRealtimePlotInput) {
  React.useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let inFlight = false;
    const timer = window.setInterval(() => {
      if (inFlight) {
        return;
      }
      inFlight = true;
      void refresh().finally(() => {
        inFlight = false;
      });
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [enabled, intervalMs, refresh]);
}
