import { createRoot } from 'react-dom/client';
import App from './App';
import AdminApp from './admin/AdminApp';
import { Gate } from './auth/Gate';
import './index.css';

const root = createRoot(document.getElementById('root')!);
if (location.pathname.replace(/\/+$/, '') === '/admin') root.render(<AdminApp />);
else root.render(<Gate>{(account) => <App account={account} key={account?.me.user.id ?? 'local'} />}</Gate>);
