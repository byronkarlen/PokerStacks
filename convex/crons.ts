import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Daily sweep of games older than 24 hours. Runs every hour so any game that
// crosses the 1-day threshold gets cleaned up within an hour of becoming
// stale, and so a backlog never builds up to break transaction limits.
crons.interval(
  "prune old games",
  { hours: 1 },
  internal.cleanup.deleteOldGames,
);

export default crons;
