// Compila el panel React a web/dist con esbuild.
//   node web/build.mjs           → build de producción
//   node web/build.mjs --watch   → recompila al guardar
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const watch = process.argv.includes('--watch');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
copyFileSync(join(here, 'index.html'), join(dist, 'index.html'));

const options = {
  entryPoints: [join(here, 'src', 'main.jsx')],
  bundle: true,
  outfile: join(dist, 'app.js'),
  format: 'esm',
  jsx: 'automatic',
  loader: { '.css': 'css' },
  target: ['es2022', 'safari15'],
  minify: !watch,
  sourcemap: watch,
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
