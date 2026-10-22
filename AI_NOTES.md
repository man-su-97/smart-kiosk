# AI notes

## Tools used
Claude Code (Claude Sonnet 5.5) in the terminal. It planned the design, wrote the backend, tests,
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
4. Smaller: the first draft typed transaction parameters with an unreadable `Parameters<Parameters<…>>` expression;
   replaced with a plain `Tx` type.
