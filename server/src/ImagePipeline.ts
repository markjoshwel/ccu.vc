import { Image, decode } from 'imagescript';

export type ProcessedImage = {
  data: Uint8Array;
  contentType: string;
  width: number;
  height: number;
};

const MAX_DIMENSION = 256;

export async function processAvatarImage(buffer: ArrayBuffer, contentType: string): Promise<ProcessedImage> {
  const uint8 = new Uint8Array(buffer);
  if (uint8.byteLength > 10 * 1024 * 1024) {
    throw new Error('Image too large to decode');
  }
  const decoded = await decode(uint8, true);
  if (!(decoded instanceof Image)) {
    throw new Error('Animated images are not supported');
  }

  const format = contentTypeToFormat(contentType.toLowerCase());

  const size = Math.min(decoded.width, decoded.height);
  const x = Math.floor((decoded.width - size) / 2);
  const y = Math.floor((decoded.height - size) / 2);
  const cropped = decoded.crop(x, y, size, size);
  const resized = cropped.resize(MAX_DIMENSION, MAX_DIMENSION, Image.RESIZE_NEAREST_NEIGHBOR);

  let data: Uint8Array;
  let outputContentType: string;

  switch (format) {
    case 'jpeg':
      data = await resized.encodeJPEG(90);
      outputContentType = 'image/jpeg';
      break;
    case 'png':
      data = await resized.encode();
      outputContentType = 'image/png';
      break;
    case 'webp':
    default:
      data = await resized.encodeWEBP(90);
      outputContentType = 'image/webp';
      break;
  }

  return {
    data,
    contentType: outputContentType,
    width: resized.width,
    height: resized.height
  };
}

function contentTypeToFormat(contentType: string): 'jpeg' | 'png' | 'webp' {
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpeg';
  if (contentType.includes('png')) return 'png';
  return 'webp';
}
