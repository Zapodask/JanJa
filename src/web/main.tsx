import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

// Sem StrictMode de propósito: o duplo mount em dev abriria duas conexões com a sala.
createRoot(document.getElementById('root')!).render(<App />)
