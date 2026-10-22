import { useEffect, useState } from "react";
import { fetchMyShifts, type Shift } from "./adminApi";

// The logged-in person's own upcoming shifts (shown to staff above the cash queue).
export function MyDuty() {
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  useEffect(() => {
    fetchMyShifts().then(setShifts).catch(() => setShifts([]));
  }, []);
  if (!shifts) return null;

  return (
    <div className="card mb-5" data-testid="my-duty">
      <h2 className="mb-2 text-lg font-extrabold">My duty</h2>
      {shifts.length === 0 ? (
        <p className="text-sm text-muted">No upcoming shifts.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {shifts.slice(0, 6).map((s) => (
            <li key={s.id} className="rounded-xl bg-soft px-3 py-2 text-sm">
              <div className="font-bold">{s.kioskCode} · {s.kioskName}</div>
              <div className="text-muted">
                {new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${s.date}T00:00:00Z`))},{" "}
                {s.startTime}–{s.endTime}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
