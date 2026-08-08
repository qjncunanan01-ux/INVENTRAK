import ReactDOM from 'react-dom/client';
import App from './App';
import { ThemeModeProvider } from './theme-mode';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <ThemeModeProvider>
    <App />
  </ThemeModeProvider>
);
