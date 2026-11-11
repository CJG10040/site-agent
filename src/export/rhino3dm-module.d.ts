// rhino3dm의 ES 모듈 빌드(rhino3dm.module.js)에 패키지의 타입을 잇는다.
declare module 'rhino3dm/rhino3dm.module.js' {
  import type { RhinoModule, RhinoModuleOptions } from 'rhino3dm'
  const rhino3dm: (options?: RhinoModuleOptions) => Promise<RhinoModule>
  export default rhino3dm
}
