import { Object3D, WebGLRenderer } from 'three'
import { XRStore } from './store.js'

/**
 * WebGL cube face texture targets in WebXR face order
 * [+X, -X, +Y, -Y, +Z, -Z]
 */
export const GL_CUBE_FACE_TARGETS = [
  0x8515, // TEXTURE_CUBE_MAP_POSITIVE_X
  0x8516, // TEXTURE_CUBE_MAP_NEGATIVE_X
  0x8517, // TEXTURE_CUBE_MAP_POSITIVE_Y
  0x8518, // TEXTURE_CUBE_MAP_NEGATIVE_Y
  0x8519, // TEXTURE_CUBE_MAP_POSITIVE_Z
  0x851a, // TEXTURE_CUBE_MAP_NEGATIVE_Z
] as const

export type XRCubeLayerEntry = {
  renderOrder: number
  readonly layer: XRCubeLayer
  readonly object3D: Object3D
}

export type XRCubeLayerOptions = {
  /** Size of each cube face in pixels (computed from faces[0].width) */
  faceSize: number
  /** 'mono' for 6 faces, 'stereo' for 12 faces (inferred from faces.length) */
  layout: XRLayerLayout
  /** Orientation quaternion */
  orientation?: DOMPointReadOnly
}

/**
 * Creates an XRCubeLayer via the WebXR binding
 */
export function createXRCubeLayer(
  originReferenceSpace: XRReferenceSpace,
  xrBinding: XRWebGLBinding,
  options: XRCubeLayerOptions,
): XRCubeLayer | undefined {
  const layer = xrBinding.createCubeLayer({
    space: originReferenceSpace,
    viewPixelWidth: options.faceSize,
    viewPixelHeight: options.faceSize,
    layout: options.layout,
    isStatic: true,
    orientation: options.orientation,
  })

  return layer ?? undefined
}

/**
 * Writes face content to an XRCubeLayer
 * Supports both mono (6 faces) and stereo (12 faces) layouts
 */
export function writeContentToXRCubeLayer(
  renderer: WebGLRenderer,
  layer: XRCubeLayer,
  frame: XRFrame,
  faces: TexImageSource[],
  faceSize: number,
): void {
  const gl = renderer.getContext() as WebGL2RenderingContext
  const binding = renderer.xr.getBinding() as XRWebGLBinding

  const isStereo = faces.length === 12

  if (isStereo) {
    // Stereo: upload 6 faces per eye (right eye first, then left)
    for (const [eyeIndex, eye] of (['right', 'left'] as const).entries()) {
      const subImage = binding.getSubImage(layer, frame, eye)
      renderer.state.bindTexture(gl.TEXTURE_CUBE_MAP, subImage.colorTexture)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)

      for (let i = 0; i < 6; i++) {
        const face = faces[eyeIndex * 6 + i]
        gl.texSubImage2D(
          GL_CUBE_FACE_TARGETS[i],
          0, // mip level
          0,
          0, // offset
          faceSize,
          faceSize,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          face,
        )
      }
    }
  } else {
    // Mono: upload 6 faces
    const subImage = binding.getSubImage(layer, frame)
    renderer.state.bindTexture(gl.TEXTURE_CUBE_MAP, subImage.colorTexture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)

    for (let i = 0; i < 6; i++) {
      gl.texSubImage2D(
        GL_CUBE_FACE_TARGETS[i],
        0, // mip level
        0,
        0, // offset
        faceSize,
        faceSize,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        faces[i],
      )
    }
  }
}

/**
 * Sets up an XRCubeLayer for static image content with redraw handling
 */
export function setupXRCubeImageLayer(
  renderer: WebGLRenderer,
  store: XRStore<any>,
  layer: XRCubeLayer,
  faces: TexImageSource[],
  faceSize: number,
): () => void {
  let stop = false

  const draw = async () => {
    const frame = await store.requestFrame()
    if (stop || !frame) {
      return
    }
    writeContentToXRCubeLayer(renderer, layer, frame, faces, faceSize)
  }

  layer.addEventListener('redraw', draw)
  draw()

  return () => {
    stop = true
    layer.removeEventListener('redraw', draw)
  }
}
