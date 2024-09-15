import semver, { SemVer } from 'semver';
import { promisify } from 'node:util';
import { exec } from 'child_process';

export async function getConfiguratorVersion(): Promise<SemVer> {
	const v = (await promisify(exec)('git describe --tags --always', {
		cwd: process.env.RATOS_SCRIPT_DIR,
	}).then(({ stdout }) => stdout.trim())) as GitVersion;
	return new SemVer(v);
}
