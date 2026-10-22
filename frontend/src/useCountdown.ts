import { useEffect, useState } from "react";

// The counter's clock may be minutes wrong, so we never compare it with a server
// timestamp. Instead the server tells us "N seconds left" and we count down that
// N ourselves using performance.now(), a stopwatch that only measures elapsed
// time and ignores the wall-clock date/time setting.
// Every new value from the server (each poll) restarts the stopwatch, which
// corrects any drift.
export function useCountdown(secondsFromServer: number): number {
  const [secondsLeft, setSecondsLeft] = useState(secondsFromServer);

  useEffect(() => {
    const deadline = performance.now() + secondsFromServer * 1000;
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((deadline - performance.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [secondsFromServer]);

  return secondsLeft;
}
