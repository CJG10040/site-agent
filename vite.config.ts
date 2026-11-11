import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' : GitHub Pages 하위 경로(/site-agent/)에서도 자원 경로가 깨지지 않도록 상대 경로로 빌드
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      output: {
        // 큰 지도·도형 라이브러리는 따로 묶어 앱 코드가 바뀌어도 브라우저 캐시를 다시 씀
        codeSplitting: {
          groups: [
            { name: 'vendor-ol', test: /node_modules[\\/](ol|rbush|quickselect|earcut|color-|pbf)/ },
            { name: 'vendor-geo', test: /node_modules[\\/](@turf|polyclip-ts|proj4|d3-|delaunator|robust-predicates|splaytree|bignumber)/ },
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
})
