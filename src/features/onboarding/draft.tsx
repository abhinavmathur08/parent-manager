import Storage from 'expo-sqlite/kv-store';
import { createContext, useContext, type ReactNode } from 'react';

import { useDraftState } from '@/hooks/use-draft-state';
import type { Region } from '@/i18n';

/** Onboarding screens, in order. Each is a route in `src/app/(onboarding)`. */
export type OnboardingStep = 'welcome' | 'create-household';

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
};

const DRAFT_KEY = 'onboarding';
export const INITIAL_DRAFT: OnboardingDraft = {
  step: 'welcome',
  householdName: null,
  region: null,
};

/** The step to resume at, read outside React by the launch redirect. */
export function readOnboardingStep(): OnboardingStep {
  try {
    const stored = Storage.getItemSync(`draft:${DRAFT_KEY}`);
    const step = stored ? (JSON.parse(stored) as Partial<OnboardingDraft>).step : undefined;
    return step === 'create-household' ? step : 'welcome';
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
