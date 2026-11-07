import { render, screen } from '@testing-library/react-native';

import HomeScreen from '@/app/index';

let mockConfig: { url: string; publishableKey: string } | null = null;

jest.mock('@/lib/supabase-config', () => ({
  get supabaseConfig() {
    return mockConfig;
  },
}));

describe('HomeScreen', () => {
  it('shows the app title', async () => {
    await render(<HomeScreen />);
    expect(screen.getByTestId('home-title')).toHaveTextContent('Parent Manager');
  });

  it('reports when Supabase is not configured', async () => {
    mockConfig = null;
    await render(<HomeScreen />);
    expect(screen.getByTestId('supabase-status')).toHaveTextContent('Supabase: not configured');
  });

  it('reports when Supabase is configured', async () => {
    mockConfig = { url: 'https://abc.supabase.co', publishableKey: 'k' };
    await render(<HomeScreen />);
    expect(screen.getByTestId('supabase-status')).toHaveTextContent('Supabase: configured');
  });
});
