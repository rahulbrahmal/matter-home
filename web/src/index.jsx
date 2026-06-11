import { render } from 'solid-js/web';
import App from './App.jsx';
import './styles/index.css';
import { initPWA } from './pwa.js';

render(() => <App />, document.getElementById('root'));
initPWA();
