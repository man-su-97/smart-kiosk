import { useState } from "react";
import { login, type User } from "./adminApi";

export function LoginPage({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      onLogin(await login(email, password));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input = "rounded-xl border-2 border-line p-3 outline-none focus:border-brand";
  return (
    <div className="grid min-h-screen place-items-center p-4">
      <form onSubmit={submit} className="card flex w-full max-w-[380px] flex-col gap-3">
        <h1 className="text-2xl font-extrabold">Staff login</h1>
        <p className="text-sm text-muted">Snack Kiosk portal for staff and admins.</p>
        <label htmlFor="email" className="font-semibold">Email</label>
        <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
        <label htmlFor="password" className="font-semibold">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={input}
        />
        <button className="btn btn-primary mt-2" type="submit" disabled={!email || !password || busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>
        {error && <p className="font-bold text-bad">{error}</p>}
      </form>
    </div>
  );
}
