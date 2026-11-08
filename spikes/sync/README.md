# H-06.1 sync spike: Legend-State's Supabase sync, two devices offline

**Result: fail.** Legend-State `3.0.0-beta.48` with its Supabase plugin meets the latency target and most of the conflict rules. It fails two rules that `NFR-OFF-5` and architecture section 5 make pass-or-fail. In both cases the server ends up correct, but one device keeps a wrong copy and never corrects it.

**Recommendation:** don't build H-06.2 to H-06.4 on Legend-State's Supabase plugin as it stands. The two realistic options are PowerSync, which is a new vendor and needs the product owner's decision, or our own write queue with the server rules proved here. Both are set out under "Options" below.

## What was tested

[`two-devices.mjs`](two-devices.mjs) runs two "devices" in Node against a local Supabase stack, using the [Sync spike workflow](../../.github/workflows/sync-spike.yml):

- **Devices:** each device has its own signed-in Supabase client, its own Legend-State observable and its own persisted state, including Legend-State's queue of pending changes.
- **Offline:** "offline" makes the device's `fetch` fail the way React Native's does (`TypeError: Network request failed`) and disconnects its Realtime socket.
- **Coming back online:** the device reconnects Realtime and calls `syncState(...).sync()`, as the app would on regaining connectivity.
- **Household:** both users are parents in one household from H-01.1, and the throwaway table uses the real `private.household_role()` RLS.

The throwaway table and its server rules are in [`schema.sql`](schema.sql). The server sets `updated_at` and `version`, and records who checked an item and when. The plugin always sends the whole row, including the `version` the device last saw. That lets the server tell a stale write from a fresh one: a stale "unchecked" can't override a newer "checked", and a deleted row stays deleted.

## Results

From [run 42472125080](https://github.com/abhinavmathur08/parent-manager/actions/runs/42472125080) and [run 42472668126](https://github.com/abhinavmathur08/parent-manager/actions/runs/42472668126). Every mode gave the same results.

| Check                                                                 | Result   | Notes                                                                                                                                                                        |
| --------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An online change reaches the other device within 2 s                  | **Pass** | p50 about 415 ms, p95 about 515 ms (20 edits).                                                                                                                               |
| Offline edits survive an app restart                                  | **Pass** | The pending queue is persisted.                                                                                                                                              |
| S1: offline edits to different rows on each device both survive       | **Pass** |                                                                                                                                                                              |
| S2: both devices edit the same field offline; last write wins on both | **Pass** | Both converge on the value that reached the server last.                                                                                                                     |
| S3: both devices tick the same item, and it stays ticked              | **Pass** |                                                                                                                                                                              |
| S5: rows created offline on both devices reach both                   | **Pass** | Client-generated UUIDs.                                                                                                                                                      |
| S8: Realtime works again after reconnecting                           | **Pass** | About 110 to 150 ms.                                                                                                                                                         |
| S4: a deleted row doesn't come back                                   | **Fail** | The server keeps it deleted. If device B edited the row offline, B keeps showing it, with its edit, and never learns of the delete. Without that concurrent edit, S4 passes. |
| S6: a stale "unchecked" doesn't override a newer "checked"            | **Fail** | The server rule never runs, because B never sends the change. B's write queue stays stuck with one pending write, and B keeps showing the item unchecked.                    |
| The devices converge                                                  | **Fail** | Follows from S4 and S6: the two devices disagree, and nothing corrects it.                                                                                                   |

**Modes:** `stock` uses the plugin's own create and update. `fixed` uses create and update that throw on network errors. `fixed --skip-delete-conflict` drops S4's edit-after-delete to isolate S6.

### What goes wrong on the device

- **Stuck writes:** after reconnecting, device B ends with `numPendingSets = 1`. Its pending changes still list a row the server already has (created offline and uploaded) and the uncheck that was never sent. The write never finishes and nothing reports an error, so the app couldn't even show "not synced" honestly.
- **Not caused by the delete conflict:** S6 still fails with S4's edit-after-delete removed (`--skip-delete-conflict`).
- **Edit after delete:** the server answers B's late edit with the deleted row. B doesn't apply it, and B's next incremental pull starts after that row's timestamp, so it never sees the delete again.
- **Full re-list doesn't help:** listing the whole household on every sync instead of "changes since the last sync" made no difference ([run 42472486370](https://github.com/abhinavmathur08/parent-manager/actions/runs/42472486370), `full` mode).

I time-boxed the spike and didn't trace these into the plugin's code. They may be fixable upstream, but we'd be relying on a beta to fix them.

### Other findings

- **Still a beta:** the Supabase plugin exists only in Legend-State v3. v3 is still in beta (`3.0.0-beta.48`, published 12 July 2026, nearly four months before this spike). The stable line, 2.1.15, has no Supabase plugin.
- **Retries match a browser message:** the plugin's own retry check looks for the browser's "Failed to fetch" message, which React Native never produces. In this harness writes were retried anyway, through the sync layer's `retry` option, but the coupling is fragile.
- **Incremental pulls can miss rows:** "changes since the last sync" pulls with `updated_at > lastSync`. A transaction that commits late with an earlier timestamp could be missed. Any approach needs an overlap window or a server sequence number.
- **What carries over:** the server-side rules in `schema.sql` (version check, tombstones, server timestamps, who checked an item and when) worked as designed. They don't depend on Legend-State, and any option below can reuse them.

## Options

| Option                                                                                                 | For                                                                                                                                                                                           | Against                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. PowerSync** (architecture section 5's fallback)                                                   | Mature Postgres-to-SQLite sync with an official Supabase integration and React Native and Expo SDKs. Its upload queue is explicit: our code sends each write, so it can use our server rules. | A new vendor (a **Decision** for the product owner). A free tier exists; paid plans need checking on powersync.com/pricing. Sync rules are one more thing to maintain. |
| **B. Our own write queue,** keeping Legend-State (or plain `expo-sqlite`) for local state and Realtime | No new vendor. The server rules are already proved. The queue is ours to test with this harness.                                                                                              | The most work and the most risk (architecture section 5's third option). H-06.3 grows from S to M.                                                                     |
| C. Wait for a fixed Legend-State release                                                               | No new vendor.                                                                                                                                                                                | No date, and the plugin is a beta.                                                                                                                                     |

**Proposal:** run the same harness against PowerSync before committing, as a one-day spike. If the product owner doesn't want a new vendor, choose B.

## Running it

The workflow runs on pushes to `spike/27-*` branches, or from the Actions tab. To run locally with Docker:

```bash
pnpm supabase start
docker exec -i supabase_db_parent-manager psql -U postgres < spikes/sync/schema.sql
set -a; eval "$(pnpm supabase status -o env)"; set +a
node spikes/sync/two-devices.mjs fixed
```
