import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { nodeModulesPolyfillPlugin } from 'esbuild-plugins-node-modules-polyfill';

const require = createRequire(import.meta.url);
// Remove only generated browser chunks so obsolete hashes do not enter releases.
await rm('dist/browser', { recursive: true, force: true });
// Ship ready-to-use modules: consumers need neither Node polyfills nor a backend.
const result = await build({
	entryPoints: {
		index: 'src/index.ts',
		qr: 'scripts/qr-entry.js',
		wallet: 'src/wallet/index.ts',
		verification: 'src/verification/index.ts',
	},
	outdir: 'dist/browser',
	entryNames: '[name]',
	bundle: true,
	format: 'esm',
	platform: 'browser',
	target: 'es2022',
	splitting: true,
	minify: true,
	metafile: true,
	legalComments: 'linked',
	define: { global: 'globalThis' },
	plugins: [
		{
			// Monero's Babel output requires a callable CommonJS assert export.
			name: 'commonjs-assert',
			setup(build) {
				build.onResolve({ filter: /^(?:node:)?assert$/ }, () => ({
					path: require.resolve('assert/'),
				}));
			},
		},
		nodeModulesPolyfillPlugin({ globals: { Buffer: true, process: true } }),
	],
});
// Retain dependency licenses for users copying the static browser directory.
const roots = new Set(['node_modules/@jspm/core']);
for (const file of Object.keys(result.metafile.inputs)) {
	const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(file);
	if (match && (file.startsWith('node_modules/') || file.startsWith('/')))
		roots.add(match[1]);
}
const notices = [
	'Connect.js browser bundle: dependency license notices. Connect.js itself is under CORE License.',
];
for (const root of [...roots].sort()) {
	const manifest = JSON.parse(await readFile(`${root}/package.json`, 'utf8'));
	const names = (await readdir(root)).filter((name) =>
		/^(?:licen[cs]e|copying|notice)(?:[.-]|$)/i.test(name),
	);
	notices.push(
		`\n${manifest.name}@${manifest.version} (${manifest.license ?? 'see package'})`,
	);
	for (const name of names) {
		const path = `${root}/${name}`;
		try {
			notices.push(await readFile(path, 'utf8'));
		} catch (error) {
			if (error.code !== 'EISDIR') throw error;
		}
	}
}
await writeFile('dist/browser/THIRD_PARTY_LICENSES.txt', notices.join('\n\n'));
