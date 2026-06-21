import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import './i18n'
import App from './App.tsx'
import { AuthProvider } from './context/AuthContext'

// HashRouter (not BrowserRouter) — GitHub Pages serves static files with no
// server-side rewrite rule, so a deep link like /explorer/LP-123 needs the
// route state to live in the URL fragment (#/explorer/LP-123) rather than
// the path, or a hard refresh / shared link returns a 404. This is the only
// routing-mechanism change in this migration; no screens, components, or
// navigation behavior changed.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </StrictMode>,
)
