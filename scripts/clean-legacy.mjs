import { rm } from 'node:fs/promises';
// Clear generated output so removed APIs and old chunks cannot enter a release.
await rm(new URL('../dist/', import.meta.url), {
	recursive: true,
	force: true,
});
