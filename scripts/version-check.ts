import { HARNESS_VERSION } from '../lib/telemetry';

const root = new URL('../', import.meta.url);
const pkg = await Bun.file(new URL('package.json', root)).json();
const lock = await Bun.file(new URL('package-lock.json', root)).json();
const manifest = await Bun.file(new URL('.release-please-manifest.json', root)).json();
const versions = [
  pkg.version,
  lock.version,
  lock.packages[''].version,
  manifest['.'],
  HARNESS_VERSION,
];
if (!/^\d+\.\d+\.\d+$/.test(pkg.version) || versions.some((version) => version !== pkg.version)) {
  throw new Error(`Version mismatch: ${JSON.stringify(versions)}`);
}
const changelog = await Bun.file(new URL('CHANGELOG.md', root)).text();
if (!changelog.includes(`## ${pkg.version}`) && !changelog.includes(`## [${pkg.version}]`)) {
  throw new Error(`Missing changelog entry for ${pkg.version}`);
}
console.log(`Version ${pkg.version}: package, lockfile, manifest, telemetry and changelog agree.`);
