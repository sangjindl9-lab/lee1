import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';
import { applyTheme, getTheme } from './theme';
applyTheme(getTheme());
createRoot(document.getElementById('root')!).render(<App />);
