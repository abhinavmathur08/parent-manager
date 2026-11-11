// Job records and the allowance, through the database RPCs in migration
// 20261111100000_ai_import_jobs.sql. Only the service role may call them.

import type { DraftSource, InputType, Locale, RecipeDraft, Region } from './types.ts';

export interface StartedJob {
  jobId: string;
  householdId: string;
  locale: Locale;
  region: Region;
}

export type FinishOutcome =
  | {
      status: 'succeeded';
      source: DraftSource;
      draft: RecipeDraft;
      model?: string;
      costUnits?: number;
    }
  | { status: 'failed'; errorCode: string };

export interface JobStore {
  /** Checks role and the hourly limit, then records a job. Throws JobRefused. */
  start(userId: string, inputType: InputType): Promise<StartedJob>;
  /** Reserves one import of the monthly allowance. False when it's used up. */
  reserve(jobId: string): Promise<boolean>;
  /** Records the outcome. A failure gives back any reservation. */
  finish(jobId: string, outcome: FinishOutcome): Promise<void>;
}

/** The database refused to start a job; `code` is the hint it raised, such as `import.forbidden`. */
export class JobRefused extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'JobRefused';
  }
}

/** The parts of a supabase-js client the store uses. */
export interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string; hint?: string | null } | null }>;
}

const REFUSAL_CODES = new Set(['import.forbidden', 'import.rate_limited']);

export function createJobStore(client: RpcClient): JobStore {
  return {
    async start(userId, inputType) {
      const { data, error } = await client.rpc('ai_import_start', {
        p_user_id: userId,
        p_input_type: inputType,
      });
      if (error) {
        if (error.hint && REFUSAL_CODES.has(error.hint)) throw new JobRefused(error.hint);
        throw new Error('ai_import_start failed');
      }
      const row = (data as Record<string, string>[] | null)?.[0];
      if (!row) throw new Error('ai_import_start returned no job');
      return {
        jobId: row.job_id,
        householdId: row.household_id,
        locale: row.locale as Locale,
        region: row.region as Region,
      };
    },

    async reserve(jobId) {
      const { data, error } = await client.rpc('ai_import_reserve', { p_job_id: jobId });
      if (error) throw new Error('ai_import_reserve failed');
      return data === true;
    },

    async finish(jobId, outcome) {
      const args =
        outcome.status === 'succeeded'
          ? {
              p_job_id: jobId,
              p_status: 'succeeded',
              p_source: outcome.source,
              p_draft: outcome.draft,
              p_model: outcome.model ?? null,
              p_cost_units: outcome.costUnits ?? null,
            }
          : { p_job_id: jobId, p_status: 'failed', p_error_code: outcome.errorCode };
      const { error } = await client.rpc('ai_import_finish', args);
      if (error) throw new Error('ai_import_finish failed');
    },
  };
}
