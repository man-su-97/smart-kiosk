import { useEffect, useState } from "react";
import {
  addKiosk, addPerson, addShift, deleteShift, fetchKiosks, fetchPeople, fetchShifts, updatePerson,
  type Kiosk, type Person, type Shift,
} from "./adminApi";
import { todayInIndia } from "./format";

const input = "w-full min-w-0 rounded-xl border-2 border-line p-2.5 outline-none focus:border-brand";
const displayName = (p: Person) => p.name ?? p.email;

// Admin: who works here, which kiosks exist, and the duty roster (who runs which kiosk when).
export function TeamAndDuty() {
  const [people, setPeople] = useState<Person[]>([]);
  const [kiosks, setKiosks] = useState<Kiosk[]>([]);
  const [error, setError] = useState("");

  const load = () =>
    Promise.all([fetchPeople(), fetchKiosks()])
      .then(([p, k]) => {
        setPeople(p);
        setKiosks(k);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-3xl font-extrabold tracking-tight">Staff &amp; duty</h1>
      {error && <p className="font-bold text-bad">{error}</p>}
      <Roster people={people.filter((p) => p.active)} kiosks={kiosks.filter((k) => k.active)} onChanged={load} />
      <div className="grid gap-6 lg:grid-cols-2">
        <People people={people} onChanged={load} />
        <Kiosks kiosks={kiosks} onChanged={load} />
      </div>
    </section>
  );
}

function Roster({ people, kiosks, onChanged }: { people: Person[]; kiosks: Kiosk[]; onChanged: () => void }) {
  const [from, setFrom] = useState(todayInIndia());
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [form, setForm] = useState({ kioskId: "", userId: "", date: todayInIndia(), startTime: "09:00", endTime: "17:00", note: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // One week from the chosen day.
  const to = (() => {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 6);
    return d.toISOString().slice(0, 10);
  })();
  const load = () => fetchShifts({ from, to }).then(setShifts).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [from]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    try {
      await addShift({ ...form, kioskId: Number(form.kioskId), userId: Number(form.userId) });
      setMessage("Shift saved.");
      load();
      onChanged(); // "on duty now" may have changed
    } catch (err) {
      setError((err as Error).message); // e.g. "Someone is already on duty at this kiosk during those hours"
    }
  }

  async function remove(id: number) {
    await deleteShift(id).catch((e) => setError(e.message));
    load();
    onChanged();
  }

  const days = [...new Set(shifts.map((s) => s.date))];
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [key]: e.target.value });

  return (
    <div className="card" data-testid="roster">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-extrabold">Duty roster</h2>
        <label className="flex items-center gap-2 text-sm font-semibold">
          Week from
          <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} className={input} />
        </label>
      </div>

      <form onSubmit={save} className="mb-4 grid gap-2 rounded-2xl bg-soft p-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="New shift">
        <select aria-label="Kiosk" value={form.kioskId} onChange={set("kioskId")} className={input} required>
          <option value="">Kiosk…</option>
          {kiosks.map((k) => <option key={k.id} value={k.id}>{k.code} · {k.name}</option>)}
        </select>
        <select aria-label="Staff member" value={form.userId} onChange={set("userId")} className={input} required>
          <option value="">Staff member…</option>
          {people.map((p) => <option key={p.id} value={p.id}>{displayName(p)}</option>)}
        </select>
        <input aria-label="Date" type="date" value={form.date} onChange={set("date")} className={input} required />
        <input aria-label="Start" type="time" value={form.startTime} onChange={set("startTime")} className={input} required />
        <input aria-label="End" type="time" value={form.endTime} onChange={set("endTime")} className={input} required />
        <input aria-label="Note" placeholder="Note (optional)" value={form.note} onChange={set("note")} className={input} maxLength={100} />
        <button className="btn btn-primary px-4 py-2.5 text-base" type="submit">Add shift</button>
      </form>
      <p className="mb-3 text-xs text-muted">Times are India time. An end time before the start means the shift runs past midnight.</p>
      {message && <p className="mb-2 font-semibold text-[#167a4a]" role="status">{message}</p>}
      {error && <p className="mb-2 font-bold text-bad">{error}</p>}

      {shifts.length === 0 && <p className="text-sm text-muted">No shifts this week.</p>}
      {days.map((day) => (
        <div key={day} className="mb-3">
          <h3 className="mb-1 text-sm font-bold text-muted">
            {new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`))}
          </h3>
          <table className="w-full text-sm">
            <tbody>
              {shifts.filter((s) => s.date === day).map((s) => (
                <tr key={s.id} className="border-t border-line" data-testid="shift-row">
                  <td className="w-28 py-1.5 font-semibold tabular-nums">{s.startTime}–{s.endTime}</td>
                  <td className="py-1.5">{s.kioskCode} · {s.kioskName}</td>
                  <td className="py-1.5 font-semibold">{s.userName}</td>
                  <td className="py-1.5 text-muted">{s.note}</td>
                  <td className="py-1.5 text-right">
                    <button className="btn btn-ghost px-3 py-1 text-xs" onClick={() => remove(s.id)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function People({ people, onChanged }: { people: Person[]; onChanged: () => void }) {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await addPerson({ ...form, role: "staff" });
      setForm({ name: "", email: "", password: "" });
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function toggle(p: Person) {
    setError("");
    await updatePerson(p.id, { active: !p.active }).catch((e) => setError(e.message));
    onChanged();
  }

  return (
    <div className="card">
      <h2 className="mb-3 text-xl font-extrabold">Staff</h2>
      <form onSubmit={save} className="mb-3 grid gap-2 sm:grid-cols-2" aria-label="New staff member">
        <input aria-label="Full name" placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} required />
        <input aria-label="Staff email" type="email" placeholder="Email (login)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={input} required />
        <input aria-label="Staff password" type="password" placeholder="Password (8+)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={input} required minLength={8} />
        <button className="btn btn-primary px-4 py-2.5 text-base" type="submit">Add</button>
      </form>
      {error && <p className="mb-2 font-bold text-bad">{error}</p>}
      <table className="w-full text-sm">
        <tbody>
          {people.map((p) => (
            <tr key={p.id} className={`border-t border-line ${p.active ? "" : "opacity-50"}`} data-testid="person-row">
              <td className="py-1.5">
                <div className="font-semibold">{displayName(p)}</div>
                <div className="text-xs break-all text-muted">{p.email}</div>
              </td>
              <td className="py-1.5 capitalize">{p.role}</td>
              <td className="py-1.5 text-right">
                <button className="btn btn-ghost px-3 py-1 text-xs" onClick={() => toggle(p)}>{p.active ? "Deactivate" : "Activate"}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Kiosks({ kiosks, onChanged }: { kiosks: Kiosk[]; onChanged: () => void }) {
  const [form, setForm] = useState({ code: "", name: "", location: "" });
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await addKiosk(form);
      setForm({ code: "", name: "", location: "" });
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="card">
      <h2 className="mb-3 text-xl font-extrabold">Kiosks</h2>
      <form onSubmit={save} className="mb-3 grid gap-2 sm:grid-cols-2" aria-label="New kiosk">
        <input aria-label="Kiosk code" placeholder="Code (KSK-02)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className={input} required />
        <input aria-label="Kiosk name" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} required />
        <input aria-label="Location" placeholder="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className={input} />
        <button className="btn btn-primary px-4 py-2.5 text-base" type="submit">Add</button>
      </form>
      {error && <p className="mb-2 font-bold text-bad">{error}</p>}
      <table className="w-full text-sm">
        <tbody>
          {kiosks.map((k) => (
            <tr key={k.id} className="border-t border-line" data-testid="kiosk-row">
              <td className="py-1.5 font-semibold">{k.code}</td>
              <td className="py-1.5">{k.name}<div className="text-xs text-muted">{k.location}</div></td>
              <td className="py-1.5 text-right text-xs">
                {k.onDutyName ? <span className="rounded-full bg-[#dcf5e8] px-2 py-1 font-semibold text-[#167a4a]">On duty: {k.onDutyName}</span> : <span className="text-muted">Nobody on duty</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted">Open a kiosk screen as <code>/?kiosk=CODE</code> so its sales are recorded for that kiosk.</p>
    </div>
  );
}
