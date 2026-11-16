import { fitLongEdge, kindOf, MAX_IMAGE_EDGE, pickImage } from '@/features/import/image';

const mockRequestCamera = jest.fn();
const mockLaunchCamera = jest.fn();
const mockLaunchLibrary = jest.fn();
const mockResize = jest.fn();
const mockSave = jest.fn();

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: () => mockRequestCamera(),
  launchCameraAsync: (...args: unknown[]) => mockLaunchCamera(...args),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchLibrary(...args),
}));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: () => {
      const context = {
        resize: (size: unknown) => {
          mockResize(size);
          return context;
        },
        renderAsync: async () => ({ saveAsync: (options: unknown) => mockSave(options) }),
      };
      return context;
    },
  },
}));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));

const picked = (fileName: string, width = 3000, height = 4000) => ({
  canceled: false,
  assets: [{ uri: 'file:///cache/original.jpg', width, height, fileName }],
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSave.mockResolvedValue({ uri: 'file:///cache/small.jpg', width: 1200, height: 1600 });
});

describe('photo and screenshot input (R-07, FR-AI-1, FR-AI-12)', () => {
  it('shrinks the long edge to 1600 pixels, and leaves small images alone', () => {
    expect(MAX_IMAGE_EDGE).toBe(1600);
    expect(fitLongEdge(4000, 3000)).toEqual({ width: 1600, height: null });
    expect(fitLongEdge(1170, 2532)).toEqual({ width: null, height: 1600 });
    expect(fitLongEdge(800, 1200)).toBeNull();
  });

  it('tells screenshots from photos', () => {
    expect(kindOf({ fileName: 'IMG_0042.HEIC' }, 'library')).toBe('photo');
    expect(kindOf({ fileName: 'Screenshot 2026-11-16 at 09.12.png' }, 'library')).toBe(
      'screenshot',
    );
    expect(kindOf({ fileName: 'Screenshot_20261116.png' }, 'camera')).toBe('photo');
  });

  it('asks for the camera only when a photo is taken, and stops if refused', async () => {
    mockRequestCamera.mockResolvedValue({ granted: false, canAskAgain: false });
    expect(await pickImage('camera')).toEqual({ status: 'denied', canAskAgain: false });
    expect(mockLaunchCamera).not.toHaveBeenCalled();
  });

  it('takes a photo, then compresses it to a JPEG', async () => {
    mockRequestCamera.mockResolvedValue({ granted: true, canAskAgain: true });
    mockLaunchCamera.mockResolvedValue(picked('photo.jpg'));
    expect(await pickImage('camera')).toEqual({
      status: 'picked',
      input: {
        type: 'image',
        kind: 'photo',
        uri: 'file:///cache/small.jpg',
        mediaType: 'image/jpeg',
      },
    });
    expect(mockResize).toHaveBeenCalledWith({ width: null, height: 1600 });
    expect(mockSave).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.7 });
  });

  it('opens the photo library without asking for any permission', async () => {
    mockLaunchLibrary.mockResolvedValue(picked('Screenshot 1.png', 1170, 2532));
    const outcome = await pickImage('library');
    expect(mockRequestCamera).not.toHaveBeenCalled();
    expect(outcome).toEqual(
      expect.objectContaining({ input: expect.objectContaining({ kind: 'screenshot' }) }),
    );
    expect(mockLaunchLibrary).toHaveBeenCalledWith({ mediaTypes: ['images'], quality: 1 });
  });

  it('a canceled picker does nothing', async () => {
    mockLaunchLibrary.mockResolvedValue({ canceled: true, assets: null });
    expect(await pickImage('library')).toEqual({ status: 'canceled' });
    expect(mockSave).not.toHaveBeenCalled();
  });
});
