import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import { createPool } from '../../src/db/client';

/**
 * Level 7 — Section 9: Performance.
 *
 * Explicit instruction from Level 7: "Use actual measurements where
 * possible. Do not invent performance results." Every number this file
 * reports is a real `Date.now()`-measured wall-clock time from a query run
 * against this container's real PostgreSQL instance, seeded with real
 * rows. Nothing here is estimated, extrapolated, or copied from the design
 * docs' target NFRs (Level 4, Section 2) — those targets are only used
 * below as a labelled comparison point, never as a substitute for a real
 * number.
 *
 * HONEST CAVEAT, stated up front: this container is a shared, unsized
 * cloud sandbox, not the "small VM/PaaS tier" Level 4 assumed as the
 * production target, and PostgreSQL here is not tuned (default
 * `shared_buffers`, no connection pooler in front of it, other processes
 * on the same host). Absolute millisecond figures measured here should
 * therefore NOT be read as a certification that production will hit the
 * Level 4 targets — they are read as a genuine before/after, small-scale/
 * large-scale COMPARISON, which is what actually demonstrates whether
 * indexing keeps query cost sublinear as data grows. That relative
 * question is answerable here even though the absolute-latency question
 * is not. Every measured number is also written to
 * performance-results.json (in the API service root) precisely so the
 * Level 7 report can quote real figures instead of re-typing them by hand.
 */

const FACULTY = '200';
const STUDENT_A = '100';

interface Timings {
  n: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function measure(fn: () => Promise<unknown>, iterations: number): Promise<Timings> {
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = Date.now();
    await fn();
    samples.push(Date.now() - start);
  }
  samples.sort((a, b) => a - b);
  return {
    n: iterations,
    min: samples[0],
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    max: samples[samples.length - 1],
  };
}

const results: Record<string, unknown> = {};

async function seedBulkRows(pool: Pool, count: number, offset: number): Promise<void> {
  await pool.query(
    `INSERT INTO appointments (student_id, faculty_id, slot, status, reason, requested_at)
     SELECT
         100, 200,
         tstzrange('2010-01-01'::timestamptz + ((n + $1) || ' minutes')::interval,
                   '2010-01-01'::timestamptz + ((n + $1 + 15) || ' minutes')::interval),
         (ARRAY['COMPLETED','REJECTED','CANCELLED','MISSED'])[1 + (n % 4)]::appointment_status,
         'Perf seed row ' || (n + $1),
         now() - ((n + $1) || ' minutes')::interval
     FROM generate_series(1, $2) AS n`,
    [offset, count]
  );
}

describe('Level 7 — Real performance measurements (real PostgreSQL, real seeded data)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createPool();
    await pool.query('TRUNCATE appointments, audit_log, notifications RESTART IDENTITY CASCADE');
  }, 30000);

  afterAll(async () => {
    const outPath = path.join(__dirname, '..', '..', 'performance-results.json');
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
    await pool.end();
  });

  it('measures the conflict-check-style overlap query and get_available_slots() at THREE increasing data volumes (100, 5,000, 50,000 rows) to show real scaling behavior, not an assumption', async () => {
    const scales = [100, 5000, 50000];
    let seededSoFar = 0;
    const conflictCheckByScale: Record<number, Timings> = {};
    const availabilityByScale: Record<number, Timings> = {};

    for (const targetTotal of scales) {
      const toAdd = targetTotal - seededSoFar;
      if (toAdd > 0) {
        await seedBulkRows(pool, toAdd, seededSoFar);
        seededSoFar = targetTotal;
      }
      await pool.query('ANALYZE appointments');

      // The conflict-check query: the same shape of query the exclusion
      // constraint effectively performs on every book_appointment() call —
      // "does anything active overlap this candidate slot for this
      // faculty member".
      conflictCheckByScale[targetTotal] = await measure(
        () => pool.query(
          `SELECT 1 FROM appointments
           WHERE faculty_id = $1 AND status IN ('PENDING','APPROVED')
             AND slot && $2::tstzrange
           LIMIT 1`,
          [FACULTY, '[2026-12-30T10:00:00+05:30,2026-12-30T10:30:00+05:30)']
        ),
        30
      );

      // The availability-search function itself, the query Level 4
      // explicitly names as "the most computation-heavy read" and targets
      // at p95 <= 300ms even at ~50,000 historical rows.
      availabilityByScale[targetTotal] = await measure(
        () => pool.query('SELECT * FROM get_available_slots($1, $2, 30)', [FACULTY, '2026-08-24']),
        30
      );

      // eslint-disable-next-line no-console
      console.log(
        `[perf] rows=${targetTotal} conflict-check p50=${conflictCheckByScale[targetTotal].p50}ms p95=${conflictCheckByScale[targetTotal].p95}ms` +
        ` | get_available_slots p50=${availabilityByScale[targetTotal].p50}ms p95=${availabilityByScale[targetTotal].p95}ms`
      );
    }

    results['conflict_check_query_by_scale_ms'] = conflictCheckByScale;
    results['get_available_slots_by_scale_ms'] = availabilityByScale;
    results['level4_targets_ms'] = {
      standard_lookup_p95: 100,
      availability_search_p95_at_50k_rows: 300,
      booking_transaction_p95: 500,
    };

    // Sanity ceiling only (NOT the production NFR — see file header): every
    // measurement must complete in well under a second even at 50,000 rows,
    // proving the index-backed queries do not fall off a performance cliff.
    // The REAL p95 numbers (whatever they are) are what get reported and
    // compared against the Level 4 target in the Level 7 write-up, not
    // silently passed/failed here.
    for (const scale of scales) {
      expect(conflictCheckByScale[scale].p95).toBeLessThan(1000);
      expect(availabilityByScale[scale].p95).toBeLessThan(1000);
    }

    // The actual scaling claim: going from 100 to 50,000 rows must NOT
    // multiply latency by anything close to 500x (which is what a
    // sequential-scan-based, unindexed implementation would do) — a
    // sublinear/near-flat curve is the real proof indexing is working,
    // not just an EXPLAIN plan saying so in isolation.
    const growthFactor = availabilityByScale[50000].p50 / Math.max(1, availabilityByScale[100].p50);
    results['availability_search_growth_factor_100_to_50000_rows'] = growthFactor;
    // eslint-disable-next-line no-console
    console.log(`[perf] get_available_slots p50 growth factor, 100 -> 50,000 rows: ${growthFactor.toFixed(2)}x`);
    expect(growthFactor).toBeLessThan(20); // real assertion: nowhere near the ~500x a Seq Scan approach would show
  }, 100000);

  it('measures a single-appointment fetch (findById-style lookup) against the Level 4 standard-lookup target (p95 <= 100ms)', async () => {
    const { rows } = await pool.query(
      `SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
      [STUDENT_A, FACULTY, '[2026-12-31T10:00:00+05:30,2026-12-31T10:30:00+05:30)', 'Single fetch perf test', null]
    );
    const id = rows[0].id;

    const timings = await measure(() => pool.query('SELECT * FROM appointments WHERE id = $1', [id]), 50);
    results['single_appointment_fetch_ms'] = timings;
    // eslint-disable-next-line no-console
    console.log(`[perf] single-appointment fetch: p50=${timings.p50}ms p95=${timings.p95}ms (Level 4 target: p95 <= 100ms)`);

    expect(timings.p95).toBeLessThan(1000); // sanity ceiling; real p95 reported above/in the JSON file
  }, 30000);

  it('measures the booking transaction itself (book_appointment()) end-to-end, against the Level 4 booking-transaction target (p95 <= 500ms)', async () => {
    let n = 0;
    // 2027-02-02 is a Tuesday — inside Prof. Rao's seeded Mon-Fri
    // 09:00-17:00 availability window and not the day he teaches CSE301
    // (Mondays only), so migration 0006's availability check never rejects
    // an iteration here. Each iteration gets its own back-to-back,
    // non-overlapping 15-minute slot starting at 09:00; 30 iterations of
    // 15 minutes span 09:00-16:30, comfortably inside the window (a wider
    // spacing, as this test used before migration 0006 added the
    // availability gate, would run past 17:00 and start failing).
    const base = new Date('2027-02-02T09:00:00+05:30').getTime();
    const timings = await measure(async () => {
      n += 1;
      const start = new Date(base + (n - 1) * 15 * 60 * 1000).toISOString();
      const end = new Date(base + n * 15 * 60 * 1000).toISOString();
      await pool.query(
        `SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
        [STUDENT_A, FACULTY, `[${start},${end})`, `Booking perf test ${n}`, null]
      );
    }, 30);

    results['booking_transaction_ms'] = timings;
    // eslint-disable-next-line no-console
    console.log(`[perf] book_appointment() end-to-end: p50=${timings.p50}ms p95=${timings.p95}ms (Level 4 target: p95 <= 500ms)`);

    expect(timings.p95).toBeLessThan(1000);
  }, 30000);

  it('measures the reporting/dashboard aggregate query LIVE (recomputed from scratch) versus reading the materialized view, quantifying the actual cost the materialized view avoids', async () => {
    const liveTimings = await measure(
      () => pool.query(`
        SELECT f.id AS faculty_id, u.full_name,
               COUNT(*) FILTER (WHERE a.status = 'COMPLETED') AS completed_count,
               COUNT(*) FILTER (WHERE a.status = 'MISSED')    AS missed_count,
               COUNT(a.id) AS total_requests
        FROM faculty f
        JOIN users u ON u.id = f.id
        LEFT JOIN appointments a ON a.faculty_id = f.id
        GROUP BY f.id, u.full_name
      `),
      20
    );

    await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY faculty_appointment_stats');
    const materializedTimings = await measure(
      () => pool.query('SELECT * FROM faculty_appointment_stats'),
      20
    );

    results['dashboard_aggregate_live_recompute_ms'] = liveTimings;
    results['dashboard_aggregate_materialized_read_ms'] = materializedTimings;
    const speedup = liveTimings.p50 / Math.max(1, materializedTimings.p50);
    results['materialized_view_speedup_factor'] = speedup;
    // eslint-disable-next-line no-console
    console.log(
      `[perf] dashboard aggregate: LIVE recompute p50=${liveTimings.p50}ms vs MATERIALIZED read p50=${materializedTimings.p50}ms` +
      ` (${speedup.toFixed(1)}x)`
    );

    // The real claim being tested: reading the materialized view is not
    // slower than recomputing live (it should be at least as fast, usually
    // meaningfully faster once the appointments table has real volume,
    // as it does here after the scale test above).
    expect(materializedTimings.p50).toBeLessThanOrEqual(liveTimings.p50 + 5); // +5ms slack for measurement noise
  }, 30000);

  it('captures real EXPLAIN ANALYZE output for the conflict-check query at 50,000 rows, for direct inclusion in the Level 7 report (not a hand-written or assumed plan)', async () => {
    const plan = await pool.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
       SELECT 1 FROM appointments
       WHERE faculty_id = $1 AND status IN ('PENDING','APPROVED') AND slot && $2::tstzrange
       LIMIT 1`,
      [FACULTY, '[2026-12-30T10:00:00+05:30,2026-12-30T10:30:00+05:30)']
    );
    const planLines: string[] = plan.rows.map((r) => r['QUERY PLAN']);
    results['explain_analyze_conflict_check_at_50000_rows'] = planLines;
    // eslint-disable-next-line no-console
    console.log('[perf] EXPLAIN ANALYZE (conflict-check query, 50,000 rows):\n' + planLines.join('\n'));

    expect(planLines.join('\n')).toContain('Execution Time');
  });
});
