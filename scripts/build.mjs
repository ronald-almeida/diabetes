import { access, readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
await Promise.all(['public/index.html', 'public/obrigado.html', 'public/assets/logo.svg', 'public/assets/host-grotesk.woff2'].map(path => access(path)));
async function check(dir) {
  for (const file of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${file.name}`;
    if (file.isDirectory()) await check(path);
    else if (/\.(mjs|js)$/.test(file.name)) {
      const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
      if (result.status !== 0) process.exit(result.status || 1);
    }
  }
}
await check('api'); await check('lib'); await check('public');
for (const name of ['index.html', 'obrigado.html', 'privacidade.html', 'termos.html']) {
  const html = await readFile(`public/${name}`, 'utf8');
  if (!html.includes('lang="pt-BR"') || !html.includes('viewport')) throw new Error(`Invalid page: ${name}`);
}
console.log('Build verified: static pages, assets and server functions ready.');
