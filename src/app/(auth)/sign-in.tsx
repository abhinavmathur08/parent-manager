import { SignInScreen } from '@/features/auth/sign-in-screen';
import { SocialSignIn } from '@/features/auth/social-sign-in';

export default function SignInRoute() {
  return <SignInScreen providers={(props) => <SocialSignIn {...props} />} />;
}
