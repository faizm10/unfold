import { claude } from './agents/claude.js';
import { codex } from './agents/codex.js';
import { gcloud } from './gcloud/index.js';
import type { Provider } from './provider.js';
import { vercel } from './vercel/index.js';

export const providers: Record<string, Provider> = { vercel, gcloud, claude, codex };
