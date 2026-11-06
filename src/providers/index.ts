import type { Provider } from './provider.js';
import { vercel } from './vercel/index.js';

export const providers: Record<string, Provider> = { vercel };
