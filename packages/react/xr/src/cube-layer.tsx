import {
  createXRCubeLayer,
  setupXRCubeImageLayer,
  XRCubeLayerEntry,
  XRLayerEntry,
} from '@pmndrs/xr'
import { useThree } from '@react-three/fiber'
import {
  MutableRefObject,
  ReactNode,
  useEffect,
  useImperativeHandle,
  useRef,
  forwardRef,
} from 'react'
import {
  BackSide,
  BoxGeometry,
  CubeTexture,
  GLSL3,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
} from 'three'
import { useXRSessionFeatureEnabled } from './hooks.js'
import { useXR, useXRStore } from './xr.js'

export interface XRCubeLayerProps {
  /**
   * Cube face images in WebXR order: [+X, -X, +Y, -Y, +Z, -Z]
   * For mono: 6 faces
   * For stereo: 12 faces (right eye 6 faces, then left eye 6 faces)
   */
  faces: TexImageSource[]
  /**
   * Layer render order (negative = behind, default: -2000)
   * Very negative values render behind other content
   */
  renderOrder?: number
  /**
   * Orientation quaternion for the cube layer
   */
  orientation?: DOMPointReadOnly
  /**
   * Dynamic content (future)
   */
  children?: ReactNode
}

/**
 * Component for rendering high quality XRCubeLayer for cubemap skyboxes.
 * Provides native WebXR cube layer rendering with automatic fallback.
 *
 * @example
 * ```tsx
 * import { splitHorizontalCross } from '@pmndrs/xr'
 *
 * // Load faces from horizontal cross image
 * const faces = await splitHorizontalCross('/skybox-cross.png')
 *
 * // Render cube layer (renders at infinity, always behind other content)
 * <XRCubeLayer faces={faces} />
 * ```
 */
export const XRCubeLayer = forwardRef<Mesh, XRCubeLayerProps>(
  ({ faces, renderOrder = -2000, orientation, children }, ref) => {
    const layersEnabled = useXRSessionFeatureEnabled('layers')
    const meshRef = useRef<Mesh>(null)
    const layerEntryRef = useRef<XRLayerEntry | undefined>(undefined)

    // Compute face size from first face
    const faceSize = (faces[0] as ImageBitmap | HTMLImageElement).width

    useImperativeHandle(ref, () => meshRef.current!, [])

    return (
      <>
        {/* Mesh used for both fallback rendering AND as object3D for layer entry */}
        <mesh ref={meshRef} frustumCulled={false} renderOrder={layersEnabled ? -Infinity : renderOrder}>
          <boxGeometry args={[10000, 10000, 10000]} />
          <meshBasicMaterial side={BackSide} colorWrite={!layersEnabled} />
        </mesh>
        {layersEnabled ? (
          <XRCubeLayerImplementation
            meshRef={meshRef}
            layerEntryRef={layerEntryRef}
            faces={faces}
            faceSize={faceSize}
            renderOrder={renderOrder}
            orientation={orientation}
          />
        ) : (
          <FallbackXRCubeLayer meshRef={meshRef} faces={faces} />
        )}
        {children}
      </>
    )
  },
)

interface XRCubeLayerImplementationProps {
  meshRef: MutableRefObject<Mesh | null>
  layerEntryRef: MutableRefObject<XRLayerEntry | undefined>
  faces: TexImageSource[]
  faceSize: number
  renderOrder: number
  orientation?: DOMPointReadOnly
}

function XRCubeLayerImplementation({
  meshRef,
  layerEntryRef,
  faces,
  faceSize,
  renderOrder,
  orientation,
}: XRCubeLayerImplementationProps) {
  const renderer = useThree((state) => state.gl)
  const store = useXRStore()
  const originReferenceSpace = useXR((s) => s.originReferenceSpace)
  const renderOrderRef = useRef(renderOrder)
  renderOrderRef.current = renderOrder

  // Infer layout from faces count
  const layout = faces.length === 12 ? 'stereo' : 'mono'

  // Create and manage layer
  useEffect(() => {
    if (meshRef.current == null || originReferenceSpace == null) {
      return
    }

    const binding = renderer.xr.getBinding() as XRWebGLBinding | null
    if (!binding) {
      console.warn('XRCubeLayer: XRWebGLBinding not available')
      return
    }

    const layer = createXRCubeLayer(originReferenceSpace, binding, {
      faceSize,
      layout,
      orientation,
    })

    if (layer == null) {
      console.warn('XRCubeLayer: Failed to create XRCubeLayer')
      return
    }

    const layerEntry: XRLayerEntry = (layerEntryRef.current = {
      layer,
      renderOrder: renderOrderRef.current,
      object3D: meshRef.current!,
    })

    store.addLayerEntry(layerEntry)

    const cleanupImageLayer = setupXRCubeImageLayer(renderer, store, layer, faces, faceSize)

    return () => {
      store.removeLayerEntry(layerEntry)
      cleanupImageLayer()
      // XRCubeLayer doesn't have destroy() - it's garbage collected when removed from session
    }
  }, [originReferenceSpace, faces, faceSize, layout, orientation, layerEntryRef, meshRef, renderer, store])

  // Update render order
  if (layerEntryRef.current != null) {
    ;(layerEntryRef.current as { renderOrder: number }).renderOrder = renderOrder
  }

  // Update orientation when it changes
  useEffect(() => {
    if (layerEntryRef.current?.layer && orientation) {
      ;(layerEntryRef.current.layer as XRCubeLayer).orientation = orientation
    }
  }, [orientation, layerEntryRef])

  return null
}

interface FallbackXRCubeLayerProps {
  meshRef: MutableRefObject<Mesh | null>
  faces: TexImageSource[]
}

// Shader for rendering cubemap as skybox using GLSL3 (WebGL2)
// Supports stereo rendering with two cubemaps selected by eye uniform
const cubemapSkyboxShader = {
  vertexShader: `
    out vec3 vWorldDirection;

    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldDirection = worldPosition.xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_Position.z = gl_Position.w; // Push to far plane
    }
  `,
  // Mono fragment shader (single cubemap)
  fragmentShaderMono: `
    precision highp float;
    uniform samplerCube envMap;
    uniform float flipEnvMap;
    in vec3 vWorldDirection;
    out vec4 fragColor;

    void main() {
      vec3 direction = normalize(vWorldDirection);
      direction.x *= flipEnvMap;
      fragColor = texture(envMap, direction);
    }
  `,
  // Stereo fragment shader (two cubemaps, selected by eye)
  fragmentShaderStereo: `
    precision highp float;
    uniform samplerCube envMapRight;
    uniform samplerCube envMapLeft;
    uniform float flipEnvMap;
    uniform int eye; // 0 = right, 1 = left
    in vec3 vWorldDirection;
    out vec4 fragColor;

    void main() {
      vec3 direction = normalize(vWorldDirection);
      direction.x *= flipEnvMap;
      if (eye == 0) {
        fragColor = texture(envMapRight, direction);
      } else {
        fragColor = texture(envMapLeft, direction);
      }
    }
  `,
}

function FallbackXRCubeLayer({ meshRef, faces }: FallbackXRCubeLayerProps) {
  const isStereo = faces.length === 12
  const materialRef = useRef<ShaderMaterial | null>(null)

  useEffect(() => {
    if (!meshRef.current) return

    // Create CubeTexture from faces
    // CubeTexture expects faces in order: [px, nx, py, ny, pz, nz]
    // which matches our WebXR face order
    let material: ShaderMaterial
    const textures: CubeTexture[] = []

    if (isStereo) {
      // Stereo: create two cubemaps (right eye = first 6, left eye = last 6)
      const rightFaces = faces.slice(0, 6)
      const leftFaces = faces.slice(6, 12)

      const textureRight = new CubeTexture(rightFaces as HTMLImageElement[])
      textureRight.needsUpdate = true
      textures.push(textureRight)

      const textureLeft = new CubeTexture(leftFaces as HTMLImageElement[])
      textureLeft.needsUpdate = true
      textures.push(textureLeft)

      material = new ShaderMaterial({
        uniforms: {
          envMapRight: { value: textureRight },
          envMapLeft: { value: textureLeft },
          flipEnvMap: { value: -1 },
          eye: { value: 0 }, // Will be updated per-eye in onBeforeRender
        },
        vertexShader: cubemapSkyboxShader.vertexShader,
        fragmentShader: cubemapSkyboxShader.fragmentShaderStereo,
        glslVersion: GLSL3,
        side: BackSide,
        depthTest: false,
        depthWrite: false,
      })
    } else {
      // Mono: single cubemap
      const texture = new CubeTexture(faces as HTMLImageElement[])
      texture.needsUpdate = true
      textures.push(texture)

      material = new ShaderMaterial({
        uniforms: {
          envMap: { value: texture },
          flipEnvMap: { value: -1 },
        },
        vertexShader: cubemapSkyboxShader.vertexShader,
        fragmentShader: cubemapSkyboxShader.fragmentShaderMono,
        glslVersion: GLSL3,
        side: BackSide,
        depthTest: false,
        depthWrite: false,
      })
    }

    materialRef.current = material
    meshRef.current.material = material

    // For stereo, set up onBeforeRender to update eye uniform based on camera
    if (isStereo) {
      meshRef.current.onBeforeRender = (_renderer, _scene, camera) => {
        // In XR, the camera has an 'eye' property set by the XR system
        // 'left' or 'right' or undefined for non-XR
        const xrCamera = camera as { eye?: string }
        const eyeValue = xrCamera.eye === 'left' ? 1 : 0
        material.uniforms.eye.value = eyeValue
      }
    }

    return () => {
      textures.forEach(t => t.dispose())
      material.dispose()
      if (meshRef.current) {
        meshRef.current.onBeforeRender = () => {}
      }
      materialRef.current = null
    }
  }, [faces, meshRef, isStereo])

  return null
}
