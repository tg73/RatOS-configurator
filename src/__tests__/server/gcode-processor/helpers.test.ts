import { describe, test, expect } from 'vitest';
import { getConfiguratorVersion } from '@/server/gcode-processor/helpers';
import semver from 'semver';

describe('helpers', (async) => {
	test('getConfiguratorVersion result is reasonable', async () => {
		const v = await getConfiguratorVersion();
		expect(v).not.toBeNull();
		expect(semver.gt(v, '2.0.0')).toBe(true);
	});
});
