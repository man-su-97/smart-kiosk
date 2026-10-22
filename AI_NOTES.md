# AI notes

## Tools used
Claude Code in the terminal (Claude Sonnet 5.5, later Claude Opus 5.5). It planned the design, wrote the backend, tests,
frontend and README, and ran the installs, tests and the manual docker flow. I reviewed the design
decisions (especially the late-payment rule) and the code before submitting.

## A prompt that worked well
> "DO NOT OVER-ENGINEER … Express with raw pg instead of ORMs/NestJS … keep transaction blocks short and
> explicit, raw `SELECT … FOR UPDATE` so it is visually obvious how race conditions are prevented …
> Before generating any complex code, ask: can a candidate explain this in 30 seconds?"

It turned a heavier first plan (extra layers, helpers) into small `routes.ts` / `service.ts` files where every
lock is visible in the SQL, which is what I need to be able to explain live.

## Things the AI got wrong, and how it was caught
1. **A concurrency test that proved nothing.** The first "10 customers, last 2 units" test passed, but when I
   deleted `FOR UPDATE` from `createOrder` as a check, it *still passed*: on a fast local database the 10 requests
   often run one after another, so the race never happened. Caught by that deliberate "break the code" check.
   Fix: an added test that repeats the race (20 buyers, 15 rounds). Without the lock it now fails
   (e.g. 9 orders succeeded for 2 units); with the lock it passes.
2. **Frontend build failed** on `process` in `vite.config.ts` because `@types/node` was not installed.
   `tsc` found it at the first `npm run build`; added the dev dependency.
3. **Browser skill gave nothing.** I was asked to use the installed `built-in-browser` skill for the final
   screen check. It loaded with empty instructions and no browser tools (the Playwright MCP server was down), so
   I used the Playwright library directly instead and looked at the screenshots myself. Browser tests in `e2e/`
   were written the same way.
4. **Wrong product illustration.** In the kiosk redesign, my icon picker matched names with a loose regex, so
   "Chocolate Bar" matched `cola` and showed the coffee cup. Tests passed (they only counted icons); I caught it by
   looking at the screenshot. Fixed with whole-word matching, and added a test that the chocolate icon contains
   "CHOCO". The same screenshots also showed the timer sitting beside the QR code and the command wrapping mid-number.
5. **Flaky-looking browser tests that were really shared data.** After the second redesign, 3 of 9 Playwright tests
   timed out. Rather than assume the new UI was broken, I checked the stock: earlier runs had left paid-but-unclaimed
   orders, so Chocolate Bar had 0 available and its "+" button was (correctly) disabled. Fix: a global setup that resets
   orders and stock before each run; the suite now passes repeatedly.
6. **A hole a new status would have opened.** When adding "operator rejects cash → `cancelled`", the existing late-payment
   check only re-checked stock for orders that were `expired` or past their deadline. A payment arriving for a cancelled
   order (whose units were already released) would have been marked paid without checking stock, i.e. possibly oversold.
   Changed it to "re-check unless the hold is still valid", and added a test; with the old line back, that test fails.
7. **Bugs in its own code, found only when asked to attack it.** An adversarial review prompt ("you are a cynical
   QA engineer…") turned up a webhook race at the 120 s deadline that could sell a unit twice, and an API crash on a
   database restart (reproduced with `docker compose restart db`). While fixing the crash, a new test that kills a
   connection mid-transaction exposed a second crash path the first fix missed (an `error` event on a checked-out
   client). The race test was confirmed to fail against the old code before keeping it.
8. Smaller: the first draft typed transaction parameters with an unreadable `Parameters<Parameters<…>>` expression;
   replaced with a plain `Tx` type.
