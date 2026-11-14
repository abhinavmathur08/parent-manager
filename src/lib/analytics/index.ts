// Product analytics (F-07.2). Features import from here and send only schema events.
export {
  analyticsEnabled,
  identifyAnalyticsUser,
  isAnalyticsOptedOut,
  resetAnalytics,
  setAnalyticsContext,
  setAnalyticsOptOut,
  track,
} from '@/lib/analytics/client';
export type { AnalyticsContext } from '@/lib/analytics/client';
export { ANALYTICS_EVENTS } from '@/lib/analytics/schema';
export type { AnalyticsEvent, AnalyticsProperties } from '@/lib/analytics/schema';
