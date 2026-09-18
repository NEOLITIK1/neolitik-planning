import {build} from 'esbuild';
import {writeFile} from 'node:fs/promises';
const {outputFiles}=await build({entryPoints:['tests/browser-entry.js'],bundle:true,write:false,format:'iife',platform:'browser'});
await writeFile('test-algo.html',`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>NEOLITIK — Vérification planning</title><style>
body{font:14px system-ui;background:#f7f8fa;padding:24px;color:#233326}h1{font-size:22px}.test{padding:8px 12px;margin:4px 0;border-radius:6px}.pass{background:#e8f5e9}.fail{background:#ffebee;color:#b71c1c}#summary{font-size:20px;font-weight:700;margin:20px 0}
</style></head><body><h1>NEOLITIK — Contrôles du planning</h1><p>Tests construits automatiquement depuis les modules de l’application. Régénérer avec npm run test:html après une modification.</p><div id="summary"></div><div id="results"></div><script>${outputFiles[0].text.replaceAll('</script','<\\/script')}</script></body></html>`);
console.log('test-algo.html généré depuis les sources de production.');
