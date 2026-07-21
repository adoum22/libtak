import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import i18n from './i18n'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ErrorBoundary from './components/ErrorBoundary'
import { registerSW } from 'virtual:pwa-register'
import { clearChunkReloadFlag, reloadOnceForNewVersion } from './utils/reloadOnChunkError'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes - les données restent "fraîches"
      gcTime: 10 * 60 * 1000,   // 10 minutes - cache garbage collection
      retry: 1,                  // 1 retry en cas d'échec
      refetchOnWindowFocus: true,
    },
  },
})

clearChunkReloadFlag()

const initialLanguage = i18n.resolvedLanguage || i18n.language || 'fr'
document.documentElement.lang = initialLanguage
document.documentElement.dir = initialLanguage === 'ar' ? 'rtl' : 'ltr'

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  void reloadOnceForNewVersion()
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)

const updateServiceWorker = registerSW({
  immediate: true,
  onNeedRefresh() {
    // Do not interrupt an active sale or discard forms. Components may offer
    // an explicit reload action after the current workflow is saved.
    window.dispatchEvent(new CustomEvent('pwa:update-available', {
      detail: { apply: () => updateServiceWorker(true) },
    }))
  },
})
