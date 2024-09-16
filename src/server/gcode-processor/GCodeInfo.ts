/**
 * @file GCodeInfo.ts
 * @description
 *
 * @author Tom Glastonbury <t@tg73.net>
 * @license MIT
 * @copyright 2024
 *
 * THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
 * PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
 * LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
 * TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
 * USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import { getConfiguratorVersion } from '@/server/gcode-processor/helpers';
import semver, { SemVer } from 'semver';
import { GCodeError } from '@/server/gcode-processor/errors';

/** A known flavour of G-code. */
export enum GCodeFlavour {
	Unknown = 0,

	PrusaSlicer = 1 << 0,
	OrcaSlicer = 1 << 1,
	SuperSlicer = 1 << 2,

	/** Custom-generated G-code, may declare conformance with the RatOS dialect. This is yet to be defined. */
	RatOS = 1 << 3,

	Any = 0xffff,
}

/** Characteristics of a G-code file, typically determined from the header lines of the file. */
export class GCodeInfo {
	/**
	 * Parses header (top of file) comments.
	 * @param header One or more newline-separated lines from the start of a gcode file. Normally, at least the first three lines should be provided.
	 */
	static tryParseHeader(header: string): GCodeInfo | null {
		let match =
			/^; generated (by|with) (?<GENERATOR>[^\s]+) (?<VERSION>[^\s]+) (in RatOS dialect (?<RATOS_DIALECT_VERSION>[^\s]+) )?on (?<DATE>[^\s]+) at (?<TIME>.*)$/im.exec(
				header,
			);

		if (match) {
			let flavour = GCodeFlavour.Unknown;
			let ratosDialectVersion: string | undefined = undefined;

			switch (match.groups?.GENERATOR?.toLowerCase()) {
				case 'prusaslicer':
					flavour = GCodeFlavour.PrusaSlicer;
					break;
				case 'orcaslicer':
					flavour = GCodeFlavour.OrcaSlicer;
					break;
				case 'superslicer':
					flavour = GCodeFlavour.SuperSlicer;
					break;
				default:
					if (match.groups?.RATOS_DIALECT_VERSION) {
						flavour = GCodeFlavour.RatOS;
						ratosDialectVersion = match.groups?.RATOS_DIALECT_VERSION;
					}
					break;
			}

			let processedByRatosMatch = /^; processed by RatOS (?<VERSION>[^\s]+) on (?<DATE>[^\s]+) at (?<TIME>.*)$/im.exec(
				header,
			);

			return new GCodeInfo(
				match.groups?.GENERATOR!,
				GCodeInfo.coerceSemVerOrThrow(match.groups?.VERSION!, 'The generator version is not a valid SemVer.')!,
				flavour,
				new Date(match.groups?.DATE + ' ' + match.groups?.TIME),
				GCodeInfo.coerceSemVerOrThrow(ratosDialectVersion, 'The RatOS dialect version is not a valid SemVer.'),
				GCodeInfo.coerceSemVerOrThrow(
					processedByRatosMatch?.groups?.VERSION,
					'The processed by RatOS version is not a valid SemVer.',
				),
				processedByRatosMatch
					? new Date(processedByRatosMatch.groups?.DATE + ' ' + processedByRatosMatch.groups?.TIME)
					: undefined,
			);
		}

		return null;
	}

	static coerceSemVerOrThrow(version: string | undefined, message: string): SemVer | undefined {
		if (version === undefined) {
			return undefined;
		}
		const sv = semver.coerce(version);
		if (sv === null) {
			throw new GCodeError(message);
		}
		return sv;
	}

	static async getProcessedByRatosHeader(): Promise<string> {
		const currentCodeVersion = await getConfiguratorVersion();
		const now = new Date();
		return `; processed by RatOS ${currentCodeVersion.toString()} on ${now.toISOString().replace('T', ' at ')}`;
	}

	constructor(
		public readonly generator: string,
		public readonly generatorVersion: SemVer,
		public readonly flavour: GCodeFlavour,
		public readonly generatorTimestamp: Date,
		public readonly ratosDialectVersion?: SemVer,
		public readonly processedByRatOSVersion?: SemVer,
		public readonly processedByRatOSTimestamp?: Date,
	) {}
}
