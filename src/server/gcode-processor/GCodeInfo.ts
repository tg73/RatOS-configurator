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
import { GCodeError, GCodeProcessorError } from '@/server/gcode-processor/errors';
import date2 from 'date-and-time';
import fsReader from '@/server/helpers/fs-reader.js';
import util from 'node:util';
import { AnalysisResult } from '@/server/gcode-processor/GCodeProcessor';
import fastChunkString from '@shelf/fast-chunk-string';

/**
 * GCode File Metadata
 * -------------------
 *
 * We add metadata in two locations:
 *
 * 1. The "Processed by" header line. This is added as the first line in the processed file. Example:
 *
 * 		; processed by RatOS 2.0.2-598-g1b6c63fa on 2024-11-07 at 15:08:23 UTC
 *
 *    The header line allows us to detect already-processed data during a streaming read (eg, processing
 *    during upload). The data values are considered informative only, versus the ratos_meta block which
 *    is considered authoritative.
 *
 * 2. The ratos_meta block. This is added at the end of the file. It comprises a 'begin' line, one or
 *    more lines of base64 data, and an 'end' line. The base64 data encodes the JSON serialization of
 *    a GCodeInfo object. This data is considered authoritative.
 *
 */

export enum GCODEINFO_WARNING_CODES {
	INVALID_METADATA = 'INVALID_METADATA',
}

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

const fsReaderGetLines = util.promisify(fsReader) as (path: string, lines: number) => Promise<string>;

/** Serialized characteristics of a G-code file, typically determined from the header lines of the file. */
export interface SerializedGcodeInfo {
	generator: string;
	generatorVersion: string;
	flavour: GCodeFlavour;
	generatorTimestamp: string;
	ratosDialectVersion?: string;
	processedByRatOSVersion?: string;
	processedByRatOSTimestamp?: string;
	/** If a file has been processed, by a compatible version, the result of analysing the file. */
	analysisResult?: AnalysisResult;
}

/** Match a block like:
 *
 * ; ratos_meta begin 1234
 * ; iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAGeUlEQVR4Ad1bW08bRxjd31CpskjSPK
 * ; ratos_meta end 99
 *
 * Where 1234 is the number of base64 characters expected, and 99 is the count of lines
 * of base64 data. (NB: the above example does not have valid counts)
 */
const rxRatosMeta = /(?:^; ratos_meta begin (\d+)\n(.*))?\n; ratos_meta end (\d+)$/ms;

/** Characteristics of a G-code file, typically determined from the header lines of the file. */
export class GCodeInfo {
	/** The placeholder version used to represent files transformed by the legacy ratos.py post processor. */
	static readonly LEGACY_RATOS_VERSION = new SemVer('1.0.0-legacy');
	/**
	 * Parses header information from the specified file. This method will also detect files already processed by the legacy Python-based post processor.
	 * */
	static async fromFile(path: string, onWarning?: (code: string, message: string) => void): Promise<GCodeInfo | null> {
		const header = await fsReaderGetLines(path, 4);
		const gci = GCodeInfo.#tryParseHeader(header);

		// TODO: Versioning

		if (!gci) {
			return null;
		}

		if (gci.processedByRatOSVersion) {
			var tail = await fsReaderGetLines(path, -100);

			rxRatosMeta.lastIndex = 0;
			var match = rxRatosMeta.exec(tail);

			if (match && match[3] && !match[1]) {
				// Found end marker but not start. The end marker has a line count hint.
				// Load more this time, try to match again.
				tail = await fsReaderGetLines(path, -(102 + Number(match[3])));

				rxRatosMeta.lastIndex = 0;
				match = rxRatosMeta.exec(tail);
			}

			if (match) {
				if (match[3] && !match[1]) {
					onWarning?.(
						GCODEINFO_WARNING_CODES.INVALID_METADATA,
						'Failed to parse ratos_meta block: the begin marker was not found.',
					);
				} else {
					const expectedBase64CharCount = Number(match[1]);
					const base64str = match[2].replaceAll(/[;\s]/g, '');
					if (base64str.length != expectedBase64CharCount) {
						onWarning?.(
							GCODEINFO_WARNING_CODES.INVALID_METADATA,
							`Failed to parse ratos_meta block: expected ${expectedBase64CharCount} base64 characters, but found ${base64str.length}.`,
						);
					} else {
						const jsonStr = Buffer.from(base64str, 'base64').toString('utf-8');
						// TODO: Versioning
						gci.analysisResult = JSON.parse(jsonStr);
					}
				}
			} else {
				onWarning?.(GCODEINFO_WARNING_CODES.INVALID_METADATA, 'The ratos_meta block was not found.');
			}
		} else {
			const tail = await fsReaderGetLines(path, -3);
			if (/^; processed by RatOS($|\s)/im.test(tail)) {
				gci.processedByRatOSVersion = GCodeInfo.LEGACY_RATOS_VERSION;
			}
		}
		return gci;
	}

	/**
	 * Parses header (top of file) comments. This method will not detect files already processed by the legacy Python-based post processor.
	 * @param header One or more newline-separated lines from the start of a gcode file. Normally, at least the first three lines should be provided.
	 */
	static tryParseHeader(header: string): GCodeInfo | null {
		return GCodeInfo.#tryParseHeader(header);
	}

	static #tryParseHeader(header: string): GCodeInfo | null {
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

			let processedByRatOSVersion: SemVer | undefined = undefined;
			let processedByRatOSTimestamp: Date | undefined = undefined;

			const processedByRatosMatch =
				/^; processed by RatOS (?<VERSION>[^\s]+) on (?<DATE>[^\s]+) at (?<TIME>.*)$/im.exec(header);

			if (processedByRatosMatch) {
				processedByRatOSVersion = GCodeInfo.#coerceSemVerOrThrow(
					processedByRatosMatch?.groups?.VERSION,
					'The processed by RatOS version is not a valid SemVer.',
				);
				processedByRatOSTimestamp = new Date(
					processedByRatosMatch.groups?.DATE + ' ' + processedByRatosMatch.groups?.TIME,
				);
			}

			return new GCodeInfo(
				match.groups?.GENERATOR!,
				GCodeInfo.#coerceSemVerOrThrow(match.groups?.VERSION!, 'The generator version is not a valid SemVer.')!,
				flavour,
				new Date(match.groups?.DATE + ' ' + match.groups?.TIME),
				GCodeInfo.#coerceSemVerOrThrow(ratosDialectVersion, 'The RatOS dialect version is not a valid SemVer.'),
				processedByRatOSVersion,
				processedByRatOSTimestamp,
			);
		}

		return null;
	}

	static #coerceSemVerOrThrow(version: string | undefined, message: string): SemVer | undefined {
		if (version === undefined) {
			return undefined;
		}
		const sv = semver.coerce(version);
		if (sv === null) {
			throw new GCodeError(message);
		}
		return sv;
	}

	static getProcessedByRatosHeader(currentCodeVersion: semver.SemVer, timestamp: Date): string {
		return `; processed by RatOS ${currentCodeVersion.toString()} on ${date2.format(timestamp, 'YYYY-MM-DD [at] HH:mm:ss [UTC]', true)}`;
	}

	getRatosMetaFooter(): string {
		if (!this.analysisResult) {
			throw new GCodeProcessorError(
				'The current GCodeInfo object does not have an associated AnalysisResult, the ratos-meta footer cannot be created.',
			);
		}
		const b64 = Buffer.from(JSON.stringify(this.analysisResult)).toString('base64');
		const chunks = fastChunkString(b64, { size: 78, unicodeAware: false });
		return `\n; ratos_meta begin ${b64.length}\n${chunks.map((s) => '; ' + s + '\n')}; ratos_meta end ${chunks.length}`;
	}

	constructor(
		public generator: string,
		public generatorVersion: SemVer,
		public flavour: GCodeFlavour,
		public generatorTimestamp: Date,
		public ratosDialectVersion?: SemVer,
		public processedByRatOSVersion?: SemVer,
		public processedByRatOSTimestamp?: Date,
		public analysisResult?: AnalysisResult,
	) {}

	public toJSON(): string {
		return JSON.stringify(this.serialize());
	}

	public clone(): GCodeInfo {
		return new GCodeInfo(
			this.generator,
			new SemVer(this.generatorVersion),
			this.flavour,
			this.generatorTimestamp,
			this.ratosDialectVersion ? new SemVer(this.ratosDialectVersion) : undefined,
			this.processedByRatOSVersion ? new SemVer(this.processedByRatOSVersion) : undefined,
			this.processedByRatOSTimestamp,
			this.analysisResult,
		);
	}

	public serialize(): SerializedGcodeInfo {
		return {
			generator: this.generator,
			generatorVersion: this.generatorVersion.toString(),
			flavour: this.flavour,
			generatorTimestamp: this.generatorTimestamp.toISOString(),
			ratosDialectVersion: this.ratosDialectVersion?.toString(),
			processedByRatOSVersion: this.processedByRatOSVersion?.toString(),
			processedByRatOSTimestamp: this.processedByRatOSTimestamp?.toISOString(),
			analysisResult: this.analysisResult,
		};
	}
}
