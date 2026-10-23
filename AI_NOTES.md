# AI Notes

## Tools used

Claude Code, for planning the design and writing most of the backend, frontend, tests and documentation.
I defined the constraints, made the open design decisions (including the late-payment rule) and reviewed the output.

## A prompt that worked well

> **Role & Goal:** You are helping me build a take-home assignment for a Node.js + React position. I will have to
> explain this codebase line-by-line and answer live coding questions in a 45-minute technical interview.
>
> **CRITICAL RULE: DO NOT OVER-ENGINEER.** Everything you write must be clean, simple, idiomatic, and easy to explain.
> I need to understand and defend every single file and function. Follow these strict guidelines:
>
> - **No Complex Framework Overhead:** Use Express with raw pg (or simple SQL query builder) instead of heavy ORMs like
>   TypeORM, Prisma, or NestJS dependency injection. Raw SQL makes transactions, locks, and FOR UPDATE crystal clear.
> - **Explicit, Readable Architecture:** Avoid abstractions for the sake of abstractions (e.g., no unnecessary
>   Repository pattern layers, custom event emitters, dynamic plugin systems, or microservice patterns). Keep logic
>   straightforward inside well-organized modules/services.
> - **Explainable Concurrency:** Keep transaction blocks short and explicit. Write raw SQL queries for database locking
>   (`SELECT ... FOR UPDATE`) so it is visually obvious how race conditions are prevented.
> - **Standard Libraries First:** Use native Node.js built-ins (crypto, http) and basic standard libraries (e.g., zod,
>   express, pg, vitest). Do not pull in heavy external utilities unless explicitly needed.
> - **Clear Comments on Key Decisions:** Add concise, meaningful code comments on non-obvious logic (e.g., sorting IDs
>   before locking to prevent deadlocks, HMAC timing attack prevention, performance.now() countdown logic).
> - **Self-Contained & Modular:** Keep files structured cleanly (e.g., routes.ts, service.ts, db.ts) so I can jump
>   directly to any endpoint during a screen-share interview.
>
> Before generating any complex code or pattern, ask yourself: "Can a candidate explain this in 30 seconds during an
> interview?" If the answer is no, simplify it.

This kept the code small, with every lock visible in the SQL and each module split into `routes.ts` and `service.ts`.

## What the AI got wrong

The first concurrency test ("10 customers, last 2 units") still passed after `FOR UPDATE` was removed, because the
requests happened to run one after another. I noticed it by deliberately breaking the code to see if the test would
fail. It was replaced with a repeated 20-buyer race that fails without the lock.
