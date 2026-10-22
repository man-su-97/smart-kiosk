// Plays once when the payment is confirmed: the locker door swings open and the
// order slides out. It is pure CSS (see .locker-* in styles.css), no animation library.
export function LockerAnimation() {
  return (
    <div className="locker-scene" aria-hidden="true">
      <div className="locker">
        <div className="locker-inside">
          <div className="locker-bag">🛍️</div>
        </div>
        <div className="locker-door">
          <div className="locker-handle" />
        </div>
      </div>
      <div className="sparkle s1">✨</div>
      <div className="sparkle s2">✨</div>
      <div className="sparkle s3">✨</div>
    </div>
  );
}
