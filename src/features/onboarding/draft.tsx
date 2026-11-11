import Storage from 'expo-sqlite/kv-store';
import { createContext, useContext, type ReactNode } from 'react';

import { useDraftState } from '@/hooks/use-draft-state';
import type { DraftPerson } from '@/features/onboarding/people';
import type { Region } from '@/i18n';

/** Onboarding screens, in order. Each is a route in `src/app/(onboarding)`. */
export const ONBOARDING_STEPS = ['welcome', 'create-household', 'people', 'allergies'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/**
 * Answers so far, kept on the device as a draft so an interrupted onboarding resumes at the
 * same step with its answers (FR-ONB-7). Only what onboarding asks for: no birth dates or
 * other personal details (FR-ONB-4).
 */
export type OnboardingDraft = {
  step: OnboardingStep;
  /** Null until the user edits it, so it keeps following the default. */
  householdName: string | null;
  /** Null until chosen; the device's region is shown selected. */
  region: Region | null;
  /**
   * The people being fed, by age band only, with the due month for expecting (FR-ONB-4,
   * D-6). Null until the user edits step 3, so it keeps following the default (just you).
   */
  people: DraftPerson[] | null;
};

const DRAFT_KEY = 'onboarding';
export const INITIAL_DRAFT: OnboardingDraft = {
  step: 'welcome',
  householdName: null,
  region: null,
  people: null,
};

/** The step to resume at, read outside React by the launch redirect. */
export function readOnboardingStep(): OnboardingStep {
  try {
    const stored = Storage.getItemSync(`draft:${DRAFT_KEY}`);
    const step = stored ? (JSON.parse(stored) as Partial<OnboardingDraft>).step : undefined;
    return (ONBOARDING_STEPS as readonly unknown[]).includes(step)
      ? (step as OnboardingStep)
      : 'welcome';
  } catch {
    return 'welcome';
  }
}

type DraftContextValue = readonly [
  OnboardingDraft,
  (next: OnboardingDraft | ((previous: OnboardingDraft) => OnboardingDraft)) => void,
  () => void,
];

const DraftContext = createContext<DraftContextValue | null>(null);

export function OnboardingDraftProvider({ children }: { children: ReactNode }) {
  const draft = useDraftState<OnboardingDraft>(DRAFT_KEY, INITIAL_DRAFT);
  return <DraftContext.Provider value={draft}>{children}</DraftContext.Provider>;
}

export function useOnboardingDraft(): DraftContextValue {
  const value = useContext(DraftContext);
  if (!value) throw new Error('useOnboardingDraft needs OnboardingDraftProvider');
  return value;
}
