import { useHousehold } from '@/features/household/membership';
import { RecipesScreen } from '@/features/recipes/recipes-screen';

export default function RecipesRoute() {
  const { state } = useHousehold();
  if (state.status !== 'member') return null;
  return (
    <RecipesScreen
      locale={state.membership.locale}
      canWrite={state.membership.role !== 'caregiver'}
    />
  );
}
