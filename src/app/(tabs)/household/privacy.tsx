import { PrivacyScreen } from '@/features/account/privacy-screen';
import { useHousehold } from '@/features/household/membership';

export default function PrivacyRoute() {
  const { state } = useHousehold();
  const household =
    state.status === 'member'
      ? { id: state.membership.householdId, isParent: state.membership.role === 'parent' }
      : null;
  return <PrivacyScreen household={household} />;
}
