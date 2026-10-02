/** Where the session runs, as git sees it. */
export type Place = {
  /** The repository's name, or `<parent>/<dir>` outside one. */
  name: string;
  /** True inside a git working copy. */
  isRepo: boolean;
  /** The linked worktree's name, when the session runs in one. */
  worktree?: string;
  /** The branch, or `@<short sha>` on a detached HEAD. */
  branch?: string;
};

/** One rate-limit window as the bar draws it. */
export type Limit = {
  /** `five_hour`, `seven_day` or a gateway's `spend_limit`. */
  kind: string;
  /** 0 to 100 (past 100 on an exceeded spend limit). */
  percentUsed: number;
  /** When the window resets, in epoch milliseconds. */
  resetsAt?: number;
};

/** Everything the bar draws, refreshed from the engine's measurements and git. */
export type Snapshot = {
  place: Place;
  model?: string;
  contextPercent?: number;
  costUsd?: number;
  limits: Limit[];
  /** When the session began, in epoch milliseconds. */
  startedAt: number;
};

/** Work that keeps going beside the conversation. */
export type Activity = {
  /** Subagents running now, foreground or background. */
  agents: number;
  /** Background tasks other than subagents (shells, monitors, workflows), as of the last turn's end. */
  tasks: number;
  /** Scheduled wakeups and cron tasks (CronCreate, ScheduleWakeup, /loop), as of the last turn's end. */
  crons: number;
};

declare module 'claude-code' {
  interface PluginState {
    'statusbar': {
      snapshot: Snapshot | null;
      activity: Activity;
      /** When the running main turn began, in epoch milliseconds; null between turns. */
      turnStartedAt: number | null;
      /** How long the last finished main turn took, in milliseconds; 0 before the first. */
      lastTurnMs: number;
    };
  }
}
