# TODO: CSOC run-state self-healing (post-workshop)

Incident 2026-10-28: API container was recreated mid-apply (new hostname). The
`awaitDockerRun` watcher died with it; the S3 run record was stuck `running`
and the wizard's Next was disabled forever. Healed same-day by matching the
reconcile on *runtime* (`docker:` prefix) instead of exact runner identity —
see commit "settle orphaned docker runs across API container recreations".

What still needs doing, in priority order:

1. **Startup sweep.** On API boot, list registered environments and
   `ReconcileRun` any with `last_run.status == running`. Today healing only
   fires on read/execute of that specific environment; an env nobody reads
   stays stuck.

2. **Terminate must settle.** `HandleTerminateTerraform` on an already-exited
   container only sets the in-memory `stopping` flag. It should settle the
   record (adopt + finish with the real exit code) so a Stop click on a
   finished run can't poison a later reconciliation into `stopped`.

3. **`stopped` vs `succeeded` semantics.** `finish()` records `stopped` when
   the stop flag is set even if the exit code is 0. A run that completed
   successfully should stay `succeeded`; `stopped` should mean it was
   actually interrupted.

4. **Alert on API container recreate/restart.** The silent 12:50 recreation
   (no panic, no OOM flag) is itself unsolved — figure out what did it
   (docker-proxy? compose? external kill) and make it loud.

5. **Workdir path parity.** `ReconcileRun` assumes
   `workdir = container WorkDir + "-vars"`; `buildDockerRunArgs` uses
   `dir + "-vars"` too, but via `resolveWorkDir` on the container label.
   Keep them in lockstep (or store the vars dir in the label).

6. **UI: offer a "re-check" action** on the stuck-run banner instead of only
   Stop — a client-side nudge that re-reads the env (heal-on-read does the rest).
