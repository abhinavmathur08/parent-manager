import { FunctionsHttpError } from '@supabase/supabase-js';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { DocumentPages } from '@/features/documents/document-pages';
import { absoluteLink, readLinks } from '@/features/documents/read';
import { validateEvent } from '@/lib/analytics/schema';

// A cache folder per path, which records whether it exists, and the files written into it.
const mockLive = new Map<string, boolean>();
const mockDownloads: string[] = [];
jest.mock('expo-file-system', () => {
  const live = (uri: string) =>
    [...mockLive].some(([path, on]) => on && (path === uri || path.startsWith(`${uri}/`)));
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
    }
    get exists() {
      return live(this.uri);
    }
    create() {
      mockLive.set(this.uri, true);
    }
    delete() {
      for (const path of mockLive.keys()) {
        if (path === this.uri || path.startsWith(`${this.uri}/`)) mockLive.set(path, false);
      }
    }
  }
  class File extends Directory {
    static downloadFileAsync = jest.fn(async (url: string, target: File) => {
      mockDownloads.push(url);
      mockLive.set(target.uri, true);
      return target;
    });
  }
  return { Paths: { cache: 'file:///cache' }, Directory, File };
});
jest.mock('@/lib/supabase-config', () => ({
  supabaseConfig: { url: 'https://project.supabase.co', publishableKey: 'publishable' },
}));
const mockInvoke = jest.fn();
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    auth: { signOut: async () => ({ error: null }) },
  }),
}));
const mockTrack = jest.fn();
jest.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => mockTrack(...a) }));
const mockWebView = jest.fn();
jest.mock('react-native-webview', () => ({
  WebView: (props: unknown) => {
    mockWebView(props);
    return null;
  },
}));

const link = (n: number) => `/object/sign/documents/hh/d1/${n}.jpg?token=t${n}`;
const answers = (mime: string, links: string[]) =>
  mockInvoke.mockResolvedValue({
    data: { document_id: 'd1', mime, expires_in: 60, links },
    error: null,
  });

const show = async (online = true) => {
  const view = await render(<DocumentPages documentId="d1" locale="en-US" online={online} />);
  await act(async () => undefined);
  return view;
};

const cached = () => [...mockLive].filter(([path, on]) => on && path.includes('vault-viewer/d1/'));

beforeEach(() => {
  jest.clearAllMocks();
  mockLive.clear();
  mockDownloads.length = 0;
  Platform.OS = 'ios';
});

describe('reading a document (R2-DOC-2, D-22)', () => {
  it('asks the documents function for links relative to /storage/v1', async () => {
    answers('image/jpeg', [link(1)]);
    expect(await readLinks('d1')).toEqual({
      mime: 'image/jpeg',
      links: [`https://project.supabase.co/storage/v1${link(1)}`],
    });
    expect(mockInvoke).toHaveBeenCalledWith('documents', {
      body: { action: 'read', document_id: 'd1' },
    });
    expect(absoluteLink('/x')).toBe('https://project.supabase.co/storage/v1/x');
  });
});

describe('S-42 pages (FR2-DOC-4)', () => {
  it('downloads every page into the viewer cache, and removes them on close', async () => {
    answers('image/jpeg', [link(1), link(2)]);
    const view = await show();
    expect(screen.getByTestId('document-page-1')).toBeTruthy();
    expect(screen.getByLabelText('Page 2 of 2')).toBeTruthy();
    expect(mockDownloads).toHaveLength(2);
    expect(cached()).toHaveLength(2);
    expect(mockTrack).toHaveBeenCalledWith('document_viewed', {});
    expect(validateEvent('document_viewed', {})).toEqual({});

    await act(async () => view.unmount());
    expect(cached()).toHaveLength(0);
  });

  it('keeps nothing when closed while the pages are still downloading', async () => {
    let answer: (value: unknown) => void = () => undefined;
    mockInvoke.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const view = await show();
    expect(screen.getByTestId('document-loading')).toBeTruthy();
    await act(async () => view.unmount());
    await act(async () =>
      answer({ data: { mime: 'image/jpeg', expires_in: 60, links: [link(1)] }, error: null }),
    );
    expect(cached()).toHaveLength(0);
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('shows a PDF on iOS from its link, keeping no data and staying on storage', async () => {
    answers('application/pdf', ['/object/sign/documents/hh/d1/1.pdf?token=t']);
    await show();
    expect(mockDownloads).toHaveLength(0);
    const props = mockWebView.mock.calls.at(-1)[0];
    expect(props).toMatchObject({
      source: {
        uri: 'https://project.supabase.co/storage/v1/object/sign/documents/hh/d1/1.pdf?token=t',
      },
      incognito: true,
      cacheEnabled: false,
      originWhitelist: ['https://project.supabase.co'],
    });
    expect(props.onShouldStartLoadWithRequest({ url: 'https://evil.example/x' })).toBe(false);
    expect(
      props.onShouldStartLoadWithRequest({ url: 'https://project.supabase.co/storage/v1/x' }),
    ).toBe(true);
  });

  it('says a PDF has no viewer on Android yet', async () => {
    Platform.OS = 'android';
    answers('application/pdf', ['/object/sign/documents/hh/d1/1.pdf?token=t']);
    await show();
    expect(screen.getByTestId('document-pdf-unsupported')).toBeTruthy();
    expect(mockWebView).not.toHaveBeenCalled();
  });

  it('asks for nothing offline', async () => {
    await show(false);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('explains a refused read and tries again', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: new FunctionsHttpError(
        new Response(JSON.stringify({ error: { code: 'documents.not_found' } }), { status: 404 }),
      ),
    });
    await show();
    expect(
      screen.getByText('This document was deleted or is no longer shared with you.'),
    ).toBeTruthy();
    answers('image/jpeg', [link(1)]);
    await fireEvent.press(screen.getByTestId('document-error-action'));
    await act(async () => undefined);
    expect(screen.getByTestId('document-page-1')).toBeTruthy();
  });
});
