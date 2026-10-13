import pkg from '../package.json';

export type VersionStatus = {
  version: string;
  availableVersion: string | null;
  installedVersion: string | null;
  updateError?: string;
};
export function versionStatus(version: string, state?: unknown): VersionStatus {
  const value = state as
    | {
        spec?: string;
        availableVersion?: unknown;
        installedVersion?: unknown;
        updateError?: unknown;
      }
    | undefined;
  const newer = (candidate: unknown): candidate is string =>
    typeof candidate === 'string' &&
    /^\d+\.\d+\.\d+$/.test(candidate) &&
    Bun.semver.satisfies(candidate, `>${version}`);
  const matches = value?.spec === `${pkg.name}@${version}`;
  return {
    version,
    availableVersion: matches && newer(value?.availableVersion) ? value.availableVersion : null,
    installedVersion: matches && newer(value?.installedVersion) ? value.installedVersion : null,
    ...(matches && typeof value?.updateError === 'string'
      ? { updateError: value.updateError }
      : {}),
  };
}
export function sidebarVersion(status: VersionStatus): { title: string; update: string | null } {
  return {
    title: `AOrchestra v${status.version}`,
    update: status.installedVersion
      ? `v${status.installedVersion} installed · restart required`
      : status.updateError
        ? 'Update failed · run setup manually'
        : status.availableVersion
          ? `v${status.availableVersion} available`
          : null,
  };
}
export const versionRpc = {
  id: 'aorchestra.status',
  methods: {
    get: {
      input: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        type: 'object',
        additionalProperties: false,
        properties: {
          version: { type: 'string' },
          availableVersion: { type: ['string', 'null'] },
          installedVersion: { type: ['string', 'null'] },
          updateError: { type: 'string' },
        },
        required: ['version', 'availableVersion', 'installedVersion'],
      },
    },
  },
  events: {},
} as const;
