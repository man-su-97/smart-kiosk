# AI Notes

## Tools used

Claude Code, for planning the design and writing most of the backend, frontend, tests and documentation.
I defined the constraints, made the open design decisions (including the late-payment rule) and reviewed the output.

## A prompt that worked well

> "Do not over-engineer. Use Express with raw pg and explicit `SELECT … FOR UPDATE`, so it is obvious how race
> conditions are prevented."

This kept the code small, with every lock visible in the SQL.

## What the AI got wrong

The first concurrency test ("10 customers, last 2 units") still passed after `FOR UPDATE` was removed, because the
requests happened to run one after another. I noticed it by deliberately breaking the code to see if the test would
fail. It was replaced with a repeated 20-buyer race that fails without the lock.
