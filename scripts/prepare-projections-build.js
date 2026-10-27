// Copy only Proyecciones and its local dependencies into a fresh build directory.
const { cpSync, existsSync, mkdirSync } = require('node:fs');
const { dirname, isAbsolute, join, relative, resolve, sep } = require('node:path');

const source = resolve(__dirname, '..');
const destination = process.argv[2] && resolve(process.argv[2]);
if (!destination) throw new Error('Usage: node scripts/prepare-projections-build.js <destination>');
const fromSource = relative(source, destination);
if (!fromSource || (!fromSource.startsWith('..' + sep) && !isAbsolute(fromSource))) {
  throw new Error('The build directory must be outside the source repository');
}
if (existsSync(destination)) throw new Error('The build directory must not already exist');

const required = [
  'package.json',
  'app/layout.js',
  'app/globals.css',
  'app/api/weekly-projections',
  'app/api/health/database/route.js',
  'public/proyeccion-semanal.html',
  'public/proyeccion-admin.html',
  'lib/db.js',
  'lib/weekly-projection-snapshot.js',
];
// Preserve the existing dependency and Next.js configuration when present.
const optional = [
  'package-lock.json', 'npm-shrinkwrap.json',
  'next.config.js', 'next.config.mjs', 'next.config.ts',
  'jsconfig.json', 'tsconfig.json', 'next-env.d.ts',
];
for (const file of required) {
  if (!existsSync(join(source, file))) throw new Error('Missing Proyecciones dependency: ' + file);
}
mkdirSync(destination, { recursive: true });
for (const file of [...required, ...optional.filter(file => existsSync(join(source, file)))]) {
  const target = join(destination, file);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(source, file), target, { recursive: true, force: false, errorOnExist: true });
}
console.log('Proyecciones build source prepared at ' + destination);
