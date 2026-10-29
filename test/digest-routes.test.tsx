import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import type { Night } from '../src/digest/types.js';

const jsonl = (...lines: object[]) => lines.map((l) => JSON.stringify(l)).join('\n') + '\n';

const GOOD_NIGHT = '2026-10-28';
const EMPTY_NIGHT = '2026-10-27';
const BAD_LINE_NIGHT = '2026-10-26';
const MISSING_NIGHT = '2026-10-25';

let runsDir: string;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
  const config: RigConfig = {
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  };
  app = createApp(config);

  writeFileSync(
    join(runsDir, `${GOOD_NIGHT}.jsonl`),
    jsonl(
      { at: '2026-10-28T01:00:00+01:00', job: 'nightly-backup', status: 'retry', owner: 'ana', error: 'timeout' },
      { at: '2026-10-28T01:05:00+01:00', job: 'nightly-backup', status: 'retry', owner: 'ana', error: 'timeout' },
      { at: '2026-10-28T01:10:00+01:00', job: 'nightly-backup', status: 'retry', owner: 'ana', error: 'timeout' },
      { at: '2026-10-28T01:15:00+01:00', job: 'nightly-backup', status: 'ok', owner: 'ana' },
      { at: '2026-10-28T02:00:00+01:00', job: 'mail-sync', status: 'fail', owner: null, error: 'auth refused' },
    ),
  );
  writeFileSync(join(runsDir, `${EMPTY_NIGHT}.jsonl`), '');
  writeFileSync(
    join(runsDir, `${BAD_LINE_NIGHT}.jsonl`),
    jsonl({ at: '2026-10-26T02:00:00+01:00', job: 'mail-sync', status: 'ok', owner: null }) +
      '{"at":"2026-10-26T01:00:00+01:00","job":"nightly-backup","sta\n' +
      jsonl({ at: '2026-10-26T01:15:00+01:00', job: 'nightly-backup', status: 'ok', owner: 'ana' }),
  );
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

// Position of each row's job in the page HTML, in row order. Non-negative and ascending means same order.
function positionsInHtml(html: string, night: Night): number[] {
  return night.rows.map((r) => html.indexOf(r.job));
}

describe('GET /digest/:night', () => {
  it('renders the good night with every job', async () => {
    const res = await app.request(`/digest/${GOOD_NIGHT}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nightly-backup');
    expect(html).toContain('mail-sync');
  });

  it('lists jobs in the same order as the JSON rows', async () => {
    const html = await (await app.request(`/digest/${GOOD_NIGHT}`)).text();
    const night = (await (await app.request(`/api/digest/${GOOD_NIGHT}`)).json()) as Night;
    const positions = positionsInHtml(html, night);
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('marks the failed and heavily retried rows with class warn', async () => {
    const html = await (await app.request(`/digest/${GOOD_NIGHT}`)).text();
    expect(html).toContain('class="warn"');
  });

  it('renders a missing owner as a dash', async () => {
    const html = await (await app.request(`/digest/${GOOD_NIGHT}`)).text();
    expect(html).toContain('—');
  });

  it('returns 404 for a night with no file', async () => {
    const res = await app.request(`/digest/${MISSING_NIGHT}`);
    expect(res.status).toBe(404);
  });

  it('says "nothing ran" for an empty night', async () => {
    const res = await app.request(`/digest/${EMPTY_NIGHT}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
  });

  it('renders a bad-line night with the valid jobs', async () => {
    const res = await app.request(`/digest/${BAD_LINE_NIGHT}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('mail-sync');
    expect(html).toContain('nightly-backup');
  });

  it('returns 404 for a traversal-style night param', async () => {
    const res = await app.request('/digest/..%2F..%2Fetc');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/digest/:night', () => {
  it('returns the good night with rows in job order', async () => {
    const res = await app.request(`/api/digest/${GOOD_NIGHT}`);
    expect(res.status).toBe(200);
    const night = (await res.json()) as Night;
    expect(night.night).toBe(GOOD_NIGHT);
    expect(night.badLines).toBe(0);
    expect(night.rows.map((r) => r.job)).toEqual(['mail-sync', 'nightly-backup']);
  });

  it('reports retries, last status and last error per row', async () => {
    const night = (await (await app.request(`/api/digest/${GOOD_NIGHT}`)).json()) as Night;
    const backup = night.rows.find((r) => r.job === 'nightly-backup');
    const mail = night.rows.find((r) => r.job === 'mail-sync');
    expect(backup).toMatchObject({ retries: 3, lastStatus: 'ok', owner: 'ana' });
    expect(mail).toMatchObject({ lastStatus: 'fail', owner: null, lastError: 'auth refused' });
  });

  it('returns 404 with an error body for a night with no file', async () => {
    const res = await app.request(`/api/digest/${MISSING_NIGHT}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no such night' });
  });

  it('returns no rows for an empty night', async () => {
    const res = await app.request(`/api/digest/${EMPTY_NIGHT}`);
    expect(res.status).toBe(200);
    const night = (await res.json()) as Night;
    expect(night).toEqual({ night: EMPTY_NIGHT, rows: [], badLines: 0 });
  });

  it('counts the bad line and still returns the valid rows', async () => {
    const res = await app.request(`/api/digest/${BAD_LINE_NIGHT}`);
    expect(res.status).toBe(200);
    const night = (await res.json()) as Night;
    expect(night.badLines).toBe(1);
    expect(night.rows.map((r) => r.job)).toEqual(['mail-sync', 'nightly-backup']);
  });

  it('returns 404 for a traversal-style night param', async () => {
    const res = await app.request('/api/digest/..%2F..%2Fetc');
    expect(res.status).toBe(404);
  });
});
