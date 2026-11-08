import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AllergenNotice } from '@/components/allergen-notice';
import { Avatar, AvatarGroup } from '@/components/avatar';
import { Banner } from '@/components/banner';
import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Checkbox } from '@/components/checkbox';
import { CheckboxRow } from '@/components/checkbox-row';
import { Chip } from '@/components/chip';
import { CodeInput } from '@/components/code-input';
import { EmptyState } from '@/components/empty-state';
import { TabButton } from '@/components/floating-tab-bar';
import { IconButton } from '@/components/icon-button';
import { ListRow } from '@/components/list-row';
import { ProgressBar } from '@/components/progress-bar';
import { RadioOption } from '@/components/radio-option';
import { Screen } from '@/components/screen';
import { SectionHeader } from '@/components/section-header';
import { SegmentedControl } from '@/components/segmented-control';
import { Skeleton } from '@/components/skeleton';
import { Stepper } from '@/components/stepper';
import { Switch } from '@/components/switch';
import { Tag } from '@/components/tag';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { Toast } from '@/components/toast';
import { TopBar } from '@/components/top-bar';
import type { ColorScheme } from '@/constants/theme';
import { ThemeOverride, useTheme } from '@/hooks/use-theme';
import { formatNumber } from '@/i18n';

type Appearance = 'system' | ColorScheme;
type TextSize = 'default' | 'largest';

/**
 * Roughly the largest accessibility text size: iOS AX5 body text is 53 pt against 17 pt at the
 * default size. The preview applies it on top of the device's own text size.
 */
export const LARGEST_TEXT_SCALE = 3.1;

function Section({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[2] }}>
      <SectionHeader title={title} variant="group" style={styles.flush} />
      {children}
    </View>
  );
}

function Row({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <View style={[styles.row, { gap: theme.space[2] }]}>{children}</View>;
}

/** Every design-system component in its variants and states, with appearance and text-size switches. */
export function GalleryScreen() {
  const { t } = useTranslation();
  const [appearance, setAppearance] = useState<Appearance>('system');
  const [textSize, setTextSize] = useState<TextSize>('default');
  return (
    <ThemeOverride
      scheme={appearance === 'system' ? undefined : appearance}
      fontScale={textSize === 'largest' ? LARGEST_TEXT_SCALE : 1}
    >
      <Screen
        title={t('gallery.title')}
        onBack={() => router.back()}
        hasTabBar={false}
        testID="gallery"
      >
        <SegmentedControl
          options={[
            { value: 'system', label: t('gallery.appearance.system') },
            { value: 'light', label: t('gallery.appearance.light') },
            { value: 'dark', label: t('gallery.appearance.dark') },
          ]}
          value={appearance}
          onChange={setAppearance}
          accessibilityLabel={t('gallery.appearance.label')}
          testID="gallery-appearance"
        />
        <SegmentedControl
          options={[
            { value: 'default', label: t('gallery.textSize.default') },
            { value: 'largest', label: t('gallery.textSize.largest') },
          ]}
          value={textSize}
          onChange={setTextSize}
          accessibilityLabel={t('gallery.textSize.label')}
          testID="gallery-text-size"
        />
        <GalleryContent />
      </Screen>
    </ThemeOverride>
  );
}

function GalleryContent() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const s = (key: string, options?: Record<string, unknown>) =>
    t(`gallery.samples.${key}`, options);
  const [servings, setServings] = useState(4);
  const [reminders, setReminders] = useState(true);
  const [view, setView] = useState<'week' | 'day'>('week');
  const [region, setRegion] = useState<'us' | 'uk'>('us');
  const [milk, setMilk] = useState(true);
  const [eggs, setEggs] = useState(false);
  const [boxChecked, setBoxChecked] = useState(false);
  const [vegetarian, setVegetarian] = useState(true);
  const [name, setName] = useState('');
  const [query, setQuery] = useState(s('searchValue'));
  const [code, setCode] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [infoBanner, setInfoBanner] = useState(true);
  const alex = { name: s('memberAlex'), memberIndex: 0 };
  const sam = { name: s('memberSam'), memberIndex: 1 };

  return (
    <View style={{ gap: theme.layout.sectionGap }}>
      <Section title={s('sections.typography')}>
        <Text variant="screenTitle">{s('screenTitle')}</Text>
        <Text variant="sheetTitle">{s('sheetTitle')}</Text>
        <Text variant="cardTitle">{s('cardTitle')}</Text>
        <Text>{s('body')}</Text>
        <Text variant="caption" color="textSecondary">
          {s('caption')}
        </Text>
      </Section>

      <Section title={s('sections.buttons')}>
        <Button label={s('addMeal')} onPress={() => {}} fullWidth testID="g-button-primary" />
        <Button
          label={s('addMeal')}
          variant="secondary"
          onPress={() => {}}
          testID="g-button-secondary"
        />
        <Button
          label={s('addMeal')}
          variant="ghost"
          icon="add"
          onPress={() => {}}
          testID="g-button-ghost"
        />
        <Button
          label={s('delete')}
          variant="destructive"
          onPress={() => {}}
          testID="g-button-destructive"
        />
        <Button label={s('save')} disabled onPress={() => {}} testID="g-button-disabled" />
        <Button label={s('save')} loading onPress={() => {}} testID="g-button-loading" />
        <Row>
          <IconButton
            icon="add"
            accessibilityLabel={s('addMeal')}
            onPress={() => {}}
            testID="g-icon-plain"
          />
          <IconButton
            icon="search"
            variant="tinted"
            accessibilityLabel={s('search')}
            onPress={() => {}}
            testID="g-icon-tinted"
          />
          <IconButton
            icon="close"
            disabled
            accessibilityLabel={s('close')}
            onPress={() => {}}
            testID="g-icon-disabled"
          />
        </Row>
      </Section>

      <Section title={s('sections.inputs')}>
        <TextField
          label={s('recipeName')}
          value={name}
          onChangeText={setName}
          placeholder={s('recipePlaceholder')}
          testID="g-field"
        />
        <TextField
          label={s('email')}
          value={s('emailValue')}
          error={s('emailError')}
          testID="g-field-error"
        />
        <TextField
          label={s('recipeName')}
          value={s('cardTitle')}
          disabled
          testID="g-field-disabled"
        />
        <TextField
          variant="search"
          accessibilityLabel={s('search')}
          value={query}
          onChangeText={setQuery}
          placeholder={s('search')}
          testID="g-search"
        />
        <Stepper
          value={servings}
          onChange={setServings}
          min={1}
          max={12}
          accessibilityLabel={s('servings')}
          formatValue={(value) => formatNumber(value, i18n.language)}
          testID="g-stepper"
        />
        <Switch
          label={s('reminders')}
          description={s('remindersDetail')}
          value={reminders}
          onValueChange={setReminders}
          testID="g-switch"
        />
        <Switch
          label={s('reminders')}
          value={false}
          onValueChange={() => {}}
          disabled
          testID="g-switch-disabled"
        />
        <SegmentedControl
          options={[
            { value: 'week', label: s('week') },
            { value: 'day', label: s('day') },
          ]}
          value={view}
          onChange={setView}
          accessibilityLabel={s('view')}
          testID="g-segmented"
        />
        <RadioOption
          label={s('regionUs')}
          description={s('regionUsDetail')}
          selected={region === 'us'}
          onPress={() => setRegion('us')}
          testID="g-radio-us"
        />
        <RadioOption
          label={s('regionUk')}
          description={s('regionUkDetail')}
          selected={region === 'uk'}
          onPress={() => setRegion('uk')}
          testID="g-radio-uk"
        />
        <CodeInput value={code} onChange={setCode} accessibilityLabel={s('code')} testID="g-code" />
        <CodeInput
          value={s('codeValue')}
          onChange={() => {}}
          accessibilityLabel={s('code')}
          error={s('codeError')}
          testID="g-code-error"
        />
      </Section>

      <Section title={s('sections.lists')}>
        <View
          style={[
            styles.group,
            { borderRadius: theme.radius.card, borderColor: theme.color.border },
          ]}
        >
          <SectionHeader
            title={s('produce')}
            trailing={formatNumber(2, i18n.language)}
            testID="g-section-list"
          />
          <CheckboxRow
            label={s('milk')}
            detail={s('milkDetail')}
            checked={milk}
            onToggle={setMilk}
            checkedBy={alex}
            testID="g-checkbox-row"
          />
          <CheckboxRow
            label={s('eggs')}
            detail={s('eggsDetail')}
            checked={eggs}
            onToggle={setEggs}
            pendingSync
            testID="g-checkbox-row-pending"
          />
          <ListRow
            title={s('region')}
            variant="value"
            value={s('regionUs')}
            onPress={() => {}}
            divider
            testID="g-row-value"
          />
          <ListRow
            title={s('people')}
            variant="navigation"
            onPress={() => {}}
            divider
            testID="g-row-navigation"
          />
          <ListRow title={s('version')} subtitle={s('versionDetail')} testID="g-row-plain" />
          <ListRow title={s('people')} disabled onPress={() => {}} testID="g-row-disabled" />
        </View>
        <Row>
          <Checkbox
            checked={boxChecked}
            onChange={setBoxChecked}
            accessibilityLabel={s('milk')}
            testID="g-checkbox"
          />
          <Checkbox
            checked
            onChange={() => {}}
            accessibilityLabel={s('eggs')}
            testID="g-checkbox-checked"
          />
        </Row>
      </Section>

      <Section title={s('sections.content')}>
        <Card
          variant="highlight"
          onPress={() => {}}
          accessibilityLabel={s('tonightCard')}
          testID="g-card-highlight"
        >
          <Text variant="overline" color="primary">
            {s('tonight')}
          </Text>
          <Text variant="cardTitle">{s('cardTitle')}</Text>
          <Row>
            <Tag label={s('minutes')} testID="g-tag" />
            <Tag label={s('containsPeanuts')} variant="warning" testID="g-tag-warning" />
          </Row>
        </Card>
        <Card testID="g-card">
          <Text variant="cardTitle">{s('cardTitle')}</Text>
          <Text color="textSecondary">{s('body')}</Text>
        </Card>
        <Row>
          <Chip
            label={s('vegetarian')}
            selected={vegetarian}
            onPress={() => setVegetarian(!vegetarian)}
            testID="g-chip"
          />
          <Chip label={s('quick')} onPress={() => {}} testID="g-chip-unselected" />
          <Chip label={s('milk')} variant="action" onPress={() => {}} testID="g-chip-action" />
          <Chip label={s('quick')} disabled onPress={() => {}} testID="g-chip-disabled" />
        </Row>
        <Row>
          <Avatar {...alex} size="sm" />
          <Avatar {...sam} size="md" />
          <Avatar {...alex} size="lg" />
          <AvatarGroup members={[alex, sam]} accessibilityLabel={s('addedBy')} />
        </Row>
        <ProgressBar
          value={6}
          total={7}
          variant="segmented"
          label={s('dinnersPlanned', { count: 6, total: 7 })}
          testID="g-progress-segmented"
        />
        <ProgressBar
          value={7}
          total={7}
          label={s('dinnersPlanned', { count: 7, total: 7 })}
          testID="g-progress-linear"
        />
      </Section>

      <Section title={s('sections.feedback')}>
        <Banner variant="offline" message={s('offline')} testID="g-banner-offline" />
        <Banner
          variant="partnerActivity"
          message={s('partnerActivity')}
          testID="g-banner-partner"
        />
        {infoBanner ? (
          <Banner
            variant="info"
            message={s('info')}
            onDismiss={() => setInfoBanner(false)}
            testID="g-banner-info"
          />
        ) : null}
        <AllergenNotice
          allergen={s('peanuts')}
          person={s('memberMia')}
          testID="g-allergen-recipe"
        />
        <AllergenNotice
          allergen={s('peanuts')}
          person={s('memberMia')}
          variant="importReview"
          testID="g-allergen-import"
        />
        <AllergenNotice
          allergen={s('peanuts')}
          person={s('memberMia')}
          variant="inline"
          testID="g-allergen-inline"
        />
        <EmptyState
          icon="list"
          message={s('emptyList')}
          actionLabel={s('addItem')}
          onAction={() => {}}
          testID="g-empty"
        />
        <Skeleton variant="row" count={2} delay={0} testID="g-skeleton-row" />
        <Skeleton variant="card" count={1} delay={0} testID="g-skeleton-card" />
        <Button
          label={s('showToast')}
          variant="secondary"
          onPress={() => setToastVisible(true)}
          testID="g-show-toast"
        />
        <Button
          label={s('openSheet')}
          variant="secondary"
          onPress={() => setSheetOpen(true)}
          testID="g-open-sheet"
        />
      </Section>

      <Section title={s('sections.navigation')}>
        <View
          style={[
            styles.group,
            { borderRadius: theme.radius.card, borderColor: theme.color.border },
          ]}
        >
          <TopBar
            title={s('screenTitle')}
            onBack={() => {}}
            actions={[{ label: s('edit'), onPress: () => {}, testID: 'g-topbar-edit' }]}
            testID="g-topbar"
          />
        </View>
        <View
          style={[
            styles.row,
            styles.tabSample,
            {
              borderRadius: theme.radius.sheet,
              borderColor: theme.color.border,
              backgroundColor: theme.color.surface,
            },
          ]}
        >
          <TabButton icon="plan" label={t('tabs.plan')} isFocused testID="g-tab-active" />
          <TabButton icon="list" label={t('tabs.list')} testID="g-tab-inactive" />
        </View>
      </Section>

      <Toast
        visible={toastVisible}
        variant="undo"
        message={s('milkRemoved')}
        actionLabel={s('undo')}
        onAction={() => setMilk(true)}
        onDismiss={() => setToastVisible(false)}
        bottomOffset={theme.space[6]}
        testID="g-toast"
      />
      <BottomSheet
        visible={sheetOpen}
        variant="form"
        title={s('addMeal')}
        onClose={() => setSheetOpen(false)}
        footer={
          <Button
            label={s('save')}
            fullWidth
            onPress={() => setSheetOpen(false)}
            testID="g-sheet-save"
          />
        }
        testID="g-sheet"
      >
        <TextField
          label={s('recipeName')}
          value={name}
          onChangeText={setName}
          testID="g-sheet-field"
        />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  flush: {
    paddingHorizontal: 0,
  },
  group: {
    borderWidth: 1,
    overflow: 'hidden',
  },
  tabSample: {
    borderWidth: 1,
    padding: 6,
  },
});
