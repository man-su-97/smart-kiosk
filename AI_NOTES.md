# AI notes

**Tools.** Claude Code in the terminal (Claude Sonnet 5.5, later Claude Opus 5.5). It planned the design, wrote most of
the backend, tests, frontend and docs, and ran the installs, tests and Docker checks. I set the constraints, made the
open decisions (late-payment rule, what to build beyond the brief), and reviewed the code and screenshots.

**A prompt that worked well.**
> "DO NOT OVER-ENGINEER … Express with raw pg … keep transaction blocks short and explicit, raw `SELECT … FOR UPDATE`
> so it is visually obvious how race conditions are prevented … can a candidate explain this in 30 seconds?"

It turned a heavier first plan into small `routes.ts` / `service.ts` files where every lock is visible in the SQL.

**What the AI got wrong, and how I noticed.**
1. **A concurrency test that proved nothing.** The first "10 customers, last 2 units" test passed, but it *still passed*
   after I deleted `FOR UPDATE`: on a fast local database the requests ran one after another. Caught by deliberately
   breaking the code. Fix: a repeated 20-buyer race that fails without the lock (9 orders succeeded for 2 units).
2. **Bugs only found when I asked it to attack its own code.** An adversarial review prompt found a webhook race at the
   120 s deadline that could sell a unit twice, and an API crash on a database restart (reproduced with
   `docker compose restart db`). The new test for the crash then exposed a second crash path the first fix had missed.
3. **A wrong picture that tests did not catch.** "Chocolate Bar" showed a coffee cup because the icon matcher found
   "cola" inside "chocolate". The tests only counted icons; I saw it in a screenshot.
