import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Every test file shares one physical SQLite file (DATABASE_URL=file:./dev.db,
    // no per-file isolation) — SQLite is single-writer, so running test files
    // in parallel worker threads/processes means concurrent writes from
    // unrelated files can collide ("database is locked"), surfacing as flaky
    // failures in whichever file happens to be writing at that instant. Tests
    // within a file already run sequentially by default; this just extends
    // that to files too, trading some wall-clock time for a suite that isn't
    // flaky under the DB's real concurrency constraints.
    fileParallelism: false,
  },
});
