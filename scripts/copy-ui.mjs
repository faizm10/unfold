import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist/ui', { recursive: true });
for (const f of ['index.html', 'styles.css']) copyFileSync(`src/ui/${f}`, `dist/ui/${f}`);
