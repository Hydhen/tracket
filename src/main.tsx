import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { loadStorage } from './lib/storage.ts'
import { initTheme } from './lib/theme.ts'

async function start() {
  // The saved state is read from disk first. App is imported only after that, because its stores read it as they load.
  await loadStorage().catch((error) => console.error('Could not load the saved state', error))
  initTheme()
  const { default: App } = await import('./App.tsx')

  const queryClient = new QueryClient()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
}

void start()
