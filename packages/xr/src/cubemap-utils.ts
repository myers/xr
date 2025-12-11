/**
 * Utilities for working with cubemap images
 */

/**
 * Face order for WebXR cube layers
 * Matches the order expected by XRCubeLayer: [+X, -X, +Y, -Y, +Z, -Z]
 */
export const CUBE_FACE_ORDER = [
  'POSITIVE_X', // index 0 - right
  'NEGATIVE_X', // index 1 - left
  'POSITIVE_Y', // index 2 - top
  'NEGATIVE_Y', // index 3 - bottom
  'POSITIVE_Z', // index 4 - front
  'NEGATIVE_Z', // index 5 - back
] as const

export type CubeFace = (typeof CUBE_FACE_ORDER)[number]

/**
 * Horizontal cross cubemap layout (4x3 grid):
 * ```
 *        [+Y]
 * [-X]   [+Z]   [+X]   [-Z]
 *        [-Y]
 * ```
 */
const HORIZONTAL_CROSS_OFFSETS: Record<CubeFace, [number, number]> = {
  POSITIVE_X: [2, 1], // right
  NEGATIVE_X: [0, 1], // left
  POSITIVE_Y: [1, 0], // top
  NEGATIVE_Y: [1, 2], // bottom
  POSITIVE_Z: [1, 1], // front
  NEGATIVE_Z: [3, 1], // back
}

/**
 * Loads an image from a URL
 */
export async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

/**
 * Validates that an image has horizontal cross dimensions (4:3 aspect ratio)
 */
export function isHorizontalCross(width: number, height: number): boolean {
  const expectedAspect = 4 / 3
  const actualAspect = width / height
  return Math.abs(actualAspect - expectedAspect) < 0.01
}

/**
 * Gets the face size from a horizontal cross image
 */
export function getFaceSizeFromCross(width: number, height: number): number {
  if (!isHorizontalCross(width, height)) {
    throw new Error(`Image dimensions ${width}x${height} do not match horizontal cross format (4:3 aspect ratio)`)
  }
  return width / 4
}

/**
 * Extracts a single face from a horizontal cross image
 */
async function extractFace(source: TexImageSource, face: CubeFace, faceSize: number): Promise<ImageBitmap> {
  const [offsetX, offsetY] = HORIZONTAL_CROSS_OFFSETS[face]
  const sx = offsetX * faceSize
  const sy = offsetY * faceSize

  const canvas =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(faceSize, faceSize) : document.createElement('canvas')

  canvas.width = faceSize
  canvas.height = faceSize

  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  if (!ctx) {
    throw new Error('Failed to get 2D context')
  }

  ctx.drawImage(source as CanvasImageSource, sx, sy, faceSize, faceSize, 0, 0, faceSize, faceSize)

  if (canvas instanceof OffscreenCanvas) {
    return canvas.transferToImageBitmap()
  } else {
    return createImageBitmap(canvas)
  }
}

/**
 * Splits a horizontal cross cubemap image into 6 individual face ImageBitmaps
 *
 * @param src - Image source (URL string or HTMLImageElement)
 * @returns Promise resolving to array of 6 ImageBitmaps in WebXR cube face order
 *
 * @example
 * ```ts
 * const faces = await splitHorizontalCross('/skybox-cross.png')
 * // faces[0] = +X (right)
 * // faces[1] = -X (left)
 * // faces[2] = +Y (top)
 * // faces[3] = -Y (bottom)
 * // faces[4] = +Z (front)
 * // faces[5] = -Z (back)
 * ```
 */
export async function splitHorizontalCross(src: string | HTMLImageElement): Promise<ImageBitmap[]> {
  const img = typeof src === 'string' ? await loadImage(src) : src

  if (!img.complete) {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = reject
    })
  }

  const faceSize = getFaceSizeFromCross(img.width, img.height)

  const faces = await Promise.all(CUBE_FACE_ORDER.map((face) => extractFace(img, face, faceSize)))

  return faces
}

/**
 * Loads 6 separate face images from URLs
 *
 * @param urls - Array of 6 URLs in order: [+X, -X, +Y, -Y, +Z, -Z]
 * @returns Promise resolving to array of 6 HTMLImageElements
 */
export async function loadCubeFaces(
  urls: [string, string, string, string, string, string],
): Promise<HTMLImageElement[]> {
  if (urls.length !== 6) {
    throw new Error(`Expected 6 face URLs, got ${urls.length}`)
  }
  return Promise.all(urls.map(loadImage))
}

/**
 * Converts HTMLImageElements to ImageBitmaps for efficient texture upload
 */
export async function imagesToBitmaps(images: HTMLImageElement[]): Promise<ImageBitmap[]> {
  return Promise.all(images.map((img) => createImageBitmap(img)))
}

/**
 * Validates that an image is a cube strip (6:1 or 12:1 aspect ratio for mono/stereo)
 */
export function isCubeStrip(width: number, height: number): boolean {
  const aspect = width / height
  // 6:1 for mono, 12:1 for stereo
  return Math.abs(aspect - 6) < 0.01 || Math.abs(aspect - 12) < 0.01
}

/**
 * Flips an image horizontally (mirrors it)
 * This matches how the WebXR cube layer samples handle cube strip images
 */
function flipImageHorizontally(source: TexImageSource): HTMLCanvasElement | OffscreenCanvas {
  const width = (source as HTMLImageElement).width || (source as ImageBitmap).width
  const height = (source as HTMLImageElement).height || (source as ImageBitmap).height

  const canvas =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : document.createElement('canvas')

  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  if (!ctx) {
    throw new Error('Failed to get 2D context')
  }

  ctx.scale(-1, 1)
  ctx.drawImage(source as CanvasImageSource, -width, 0)

  return canvas
}

/**
 * Extracts a single face from a cube strip at the given index
 * @param source - Source image (should already be flipped if needed)
 * @param faceIndex - Index of the face (0-5 for mono, 0-11 for stereo)
 * @param faceSize - Size of each face
 */
async function extractStripFace(
  source: TexImageSource,
  faceIndex: number,
  faceSize: number,
): Promise<ImageBitmap> {
  const sx = faceIndex * faceSize

  const canvas =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(faceSize, faceSize) : document.createElement('canvas')

  canvas.width = faceSize
  canvas.height = faceSize

  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  if (!ctx) {
    throw new Error('Failed to get 2D context')
  }

  ctx.drawImage(source as CanvasImageSource, sx, 0, faceSize, faceSize, 0, 0, faceSize, faceSize)

  if (canvas instanceof OffscreenCanvas) {
    return canvas.transferToImageBitmap()
  } else {
    return createImageBitmap(canvas)
  }
}

/**
 * Splits a cube strip image into individual face ImageBitmaps
 *
 * Cube strip format: 6 faces in a horizontal row for mono, 12 for stereo.
 * Faces are in WebXR order: [+X, -X, +Y, -Y, +Z, -Z]
 * For stereo: right eye 6 faces followed by left eye 6 faces.
 *
 * @param src - Image source (URL string or HTMLImageElement)
 * @param flipHorizontal - Whether to flip the entire image horizontally before extracting faces
 *                         (default: true, matching WebXR samples which require this flip)
 * @returns Promise resolving to array of ImageBitmaps (6 for mono, 12 for stereo)
 *
 * @example
 * ```ts
 * // Mono cube strip (6:1 aspect ratio)
 * const monoFaces = await splitCubeStrip('/mono_cube_map.png')
 *
 * // Stereo cube strip (12:1 aspect ratio)
 * const stereoFaces = await splitCubeStrip('/stereo_cube_map.png')
 * ```
 */
export async function splitCubeStrip(
  src: string | HTMLImageElement,
  flipHorizontal: boolean = true,
): Promise<ImageBitmap[]> {
  const img = typeof src === 'string' ? await loadImage(src) : src

  if (!img.complete) {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = reject
    })
  }

  if (!isCubeStrip(img.width, img.height)) {
    throw new Error(`Image dimensions ${img.width}x${img.height} do not match cube strip format (6:1 or 12:1 aspect)`)
  }

  // Flip the entire image first if needed (matching WebXR samples approach)
  const source = flipHorizontal ? flipImageHorizontally(img) : img

  const faceSize = img.height // Each face is square, height = face size
  const faceCount = img.width / faceSize // 6 for mono, 12 for stereo

  const faces: Promise<ImageBitmap>[] = []
  for (let i = 0; i < faceCount; i++) {
    faces.push(extractStripFace(source, i, faceSize))
  }

  return Promise.all(faces)
}
