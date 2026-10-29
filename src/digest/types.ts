export type RunStatus = 'ok' | 'retry' | 'fail';

// One line of runs/<night>.jsonl. `at` is ISO 8601 with the log's offset.
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

// One row per job. Times are copied from the log as-is: offset kept, never converted to UTC.
export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

export type Night = {
  night: string;
  rows: DigestRow[];
  badLines: number;
};

// null = no runs/<night>.jsonl (route returns 404); an empty file is a Night with zero rows.
export type ReadNight = (runsDir: string, night: string) => Night | null;
