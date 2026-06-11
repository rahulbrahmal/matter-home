import { render } from 'solid-js/web';
import App from './App.jsx';
import './styles/index.css';
render(() => <App />, document.getElementById('root'));

// PWA: register the service worker (base-relative so it works at / and /matter-home/)
if ('serviceWorker' in navigator && !import.meta.env.DEV) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {});
  });
}
