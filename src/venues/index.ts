import type { VenueId } from "../types.js";
import { DecibelExecutor } from "./decibel.js";
import { ExtendedExecutor } from "./extended.js";
import { N1Executor } from "./n1.js";
import { PhoenixExecutor } from "./phoenix.js";
import { RisexExecutor } from "./risex.js";
import type { VenueExecutor } from "./types.js";

export function createExecutor(venue: VenueId, dryRun: boolean): VenueExecutor {
  switch (venue) {
    case "extended":
      return new ExtendedExecutor(dryRun);
    case "risex":
      return new RisexExecutor(dryRun);
    case "decibel":
      return new DecibelExecutor(dryRun);
    case "n1":
      return new N1Executor(dryRun);
    case "phoenix":
      return new PhoenixExecutor(dryRun);
  }
}

export type { VenueExecutor } from "./types.js";
