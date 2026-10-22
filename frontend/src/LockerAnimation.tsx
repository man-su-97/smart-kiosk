// Plays once when the payment is confirmed: the locker door swings open (3D rotate around its
// left edge) and the order slides out. Pure CSS animations from styles.css, no animation library.
export function LockerAnimation() {
  return (
    <div className="locker-scene relative my-2.5 flex justify-center perspective-[700px]" aria-hidden="true">
      <div className="relative h-[230px] w-[190px] rounded-[18px] bg-[#343862] p-3 shadow-card">
        <div className="relative size-full rounded-[10px] bg-gradient-to-b from-[#fff6d6] to-[#ffd98a]">
          <div className="locker-bag absolute top-[35%] left-1/2 z-30 animate-bag text-[64px] opacity-0">🛍️</div>
        </div>
        <div className="absolute inset-3 z-20 origin-left animate-door rounded-[10px] bg-gradient-to-br from-[#5c6bc0] to-[#3f4a94] backface-hidden">
          <div className="absolute top-1/2 right-3.5 -mt-[22px] h-11 w-2.5 rounded-md bg-[#ffd54f]" />
        </div>
      </div>
      <div className="absolute top-[10%] left-[28%] animate-twinkle text-[28px] opacity-0 [animation-delay:1.6s]">✨</div>
      <div className="absolute top-[30%] right-[26%] animate-twinkle text-[28px] opacity-0 [animation-delay:1.9s]">✨</div>
      <div className="absolute bottom-0 left-[30%] animate-twinkle text-[28px] opacity-0 [animation-delay:2.2s]">✨</div>
    </div>
  );
}
