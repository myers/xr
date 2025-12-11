import { Text } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { PointerEvents, noEvents, createXRStore, XR, XROrigin, XRCubeLayer, splitCubeStrip } from '@react-three/xr'
import { Suspense, useEffect, useState } from 'react'

const store = createXRStore({
  foveation: 0,
  requiredFeatures: ['layers'],
})

function CubeLayerSkybox({ isStereo }: { isStereo: boolean }) {
  const [faces, setFaces] = useState<ImageBitmap[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const imagePath = isStereo ? 'stereo_cube_map.png' : 'mono_cube_map.png'
    splitCubeStrip(imagePath)
      .then(setFaces)
      .catch((e) => setError(e.message))
  }, [isStereo])

  if (error) {
    console.error('Failed to load cube map:', error)
    return null
  }

  if (!faces) {
    return null
  }

  return <XRCubeLayer faces={faces} renderOrder={-2000} />
}

export function App({ isStereo }: { isStereo: boolean }) {
  return (
    <>
      <button onClick={() => store.enterVR()}>Enter VR</button>
      <Canvas
        events={noEvents}
        style={{ width: '100%', flexGrow: 1 }}
        camera={{ position: [0, 0, 0], rotation: [0, 0, 0] }}
      >
        <PointerEvents />
        <XR store={store}>
          <XROrigin position={[0, -1.5, 0]} />

          <Suspense fallback={null}>
            <CubeLayerSkybox isStereo={isStereo} />
          </Suspense>

          <Text scale={0.05} color="white" position={[0, 0, -2]}>
            {isStereo ? 'Stereo' : 'Mono'} XRCubeLayer
          </Text>

          <mesh position={[0, 0, -3]}>
            <boxGeometry args={[0.5, 0.5, 0.5]} />
            <meshStandardMaterial color="red" />
          </mesh>

          <ambientLight intensity={0.5} />
          <directionalLight position={[5, 5, 5]} intensity={1} />
        </XR>
      </Canvas>
    </>
  )
}
