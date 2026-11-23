import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { EmptyState } from '@/components/empty-state';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';
import { formatNumber } from '@/i18n';

import { storageOrigin, useDocumentPages } from './read';

/** A page is shown at the screen's width, at the ratio of a letter or A4 page until it loads. */
const PAGE_RATIO = 1 / 1.35;

/**
 * S-42's pages (FR2-DOC-4, NFR2-PERF-2): scans and images from the viewer's cache folder,
 * and on iOS a PDF straight from its signed link in a web view with no cache or website data
 * (architecture 3.5). Navigation away from the storage origin is blocked.
 */
export function DocumentPages({
  documentId,
  locale,
  online,
}: {
  documentId: string;
  locale: string;
  online: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [attempt, setAttempt] = useState(0);
  const state = useDocumentPages(documentId, online, attempt);

  if (state.status === 'loading') {
    return (
      <View style={[styles.loading, { padding: theme.space[6] }]} testID="document-loading">
        <ActivityIndicator accessibilityLabel={t('documents.viewer.loading')} />
      </View>
    );
  }
  if (state.status === 'offline') return null;
  if (state.status === 'error') {
    return (
      <EmptyState
        icon="warning"
        message={t(
          state.code === 'documents.not_found'
            ? 'documents.viewer.notFound'
            : 'documents.viewer.failed',
        )}
        actionLabel={t('documents.viewer.retry')}
        onAction={() => setAttempt((n) => n + 1)}
        testID="document-error"
      />
    );
  }
  if (state.status === 'pdf_unsupported') {
    return (
      <Text color="textSecondary" testID="document-pdf-unsupported">
        {t('documents.viewer.pdfUnsupported')}
      </Text>
    );
  }
  if (state.status === 'pdf') {
    const origin = storageOrigin();
    return (
      <View
        style={[styles.pdf, { borderRadius: theme.radius.card, borderColor: theme.color.border }]}
        testID="document-pdf"
      >
        <WebView
          source={{ uri: state.url }}
          incognito
          cacheEnabled={false}
          originWhitelist={origin ? [origin] : []}
          onShouldStartLoadWithRequest={(request) =>
            origin !== null && request.url.startsWith(`${origin}/`)
          }
          allowsLinkPreview={false}
          setSupportMultipleWindows={false}
          javaScriptEnabled={false}
          accessibilityLabel={t('documents.viewer.pdf')}
        />
      </View>
    );
  }
  return (
    <View style={{ gap: theme.space[3] }} testID="document-pages">
      {state.uris.map((uri, index) => (
        <Image
          key={uri}
          source={{ uri, cache: 'reload' }}
          resizeMode="contain"
          accessibilityLabel={t('documents.viewer.page', {
            page: formatNumber(index + 1, locale),
            pages: formatNumber(state.uris.length, locale),
          })}
          style={[
            styles.page,
            { borderRadius: theme.radius.card, backgroundColor: theme.color.surfaceAlt },
          ]}
          testID={`document-page-${index + 1}`}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { alignItems: 'center', justifyContent: 'center' },
  pdf: {
    width: '100%',
    aspectRatio: PAGE_RATIO,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  page: { width: '100%', aspectRatio: PAGE_RATIO },
});
