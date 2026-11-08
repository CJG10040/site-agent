import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' : GitHub Pages 하위 경로(/site-agent/)에서도 자원 경로가 깨지지 않도록 상대 경로로 빌드
export default defineConfig({
  plugins: [react()],
  base: './',
  // OpenLayers 포함 시 번들이 500kB를 조금 넘으므로 경고 기준만 조정
  build: { chunkSizeWarningLimit: 1000 },
})
