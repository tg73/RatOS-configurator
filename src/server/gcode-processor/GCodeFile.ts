/**
 * @file GCodeFile.ts
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

import semver, { SemVer } from 'semver';
import { GCodeError, GCodeProcessorError, InternalError } from '@/server/gcode-processor/errors';
import date2 from 'date-and-time';
import fsReader from '@/server/helpers/fs-reader.js';
import util from 'node:util';
import fastChunkString from '@shelf/fast-chunk-string';
import { GCodeFlavour, GCodeInfo } from '@/server/gcode-processor/GCodeInfo';
import {
	AnalysisResult,
	GCodeProcessor,
	GCodeProcessorOptions,
	InspectionIsComplete,
} from '@/server/gcode-processor/GCodeProcessor';
import { Readable, Transform, Writable } from 'stream';
import { FileHandle, open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import split from 'split2';
import {
	BookmarkingBufferEncoder,
	replaceBookmarkedGcodeLine,
} from '@/server/gcode-processor/BookmarkingBufferEncoder';

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

export enum GCODEFILE_WARNING_CODES {
	INVALID_METADATA = 'INVALID_METADATA',
}

export type TransformOptions = { progressTransform?: Transform } & Pick<
	GCodeProcessorOptions,
	'abortSignal' | 'allowUnsupportedSlicerVersions' | 'onWarning' | 'printerHasIdex'
>;
export type AnalyseOptions = { progressTransform?: Transform } & GCodeProcessorOptions;
export type InspectOptions = Pick<GCodeProcessorOptions, 'onWarning'>;

const fsReaderGetLines = util.promisify(fsReader) as (path: string, lines: number) => Promise<string>;

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

const rxGeneratorHeader =
	/^; generated (by|with) (?<GENERATOR>[^\s]+) (?<VERSION>[^\s]+) (in RatOS dialect (?<RATOS_DIALECT_VERSION>[^\s]+) )?on (?<DATE>[^\s]+) at (?<TIME>.*)$/im;

const rxProcessedByRatosHeader =
	/^; processed by RatOS (?<VERSION>[^\s]+) on (?<DATE>[^\s]+) at (?<TIME>\d\d:\d\d:\d\d UTC)(?: v:(?<V>2) m:(?<M>[\da-fA-F]+))?$/im;

function coerceSemVerOrThrow(version: string | undefined, message: string): SemVer | undefined {
	if (version === undefined) {
		return undefined;
	}
	const sv = semver.coerce(version);
	if (sv === null) {
		throw new GCodeError(message);
	}
	return sv;
}

class NullSink extends Writable {
	_write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
		callback();
	}
}

export class GCodeFile {
	/** The placeholder version used to represent files transformed by the legacy ratos.py post processor. */
	public static readonly LEGACY_RATOS_VERSION = new SemVer('1.0.0-legacy');

	private static getRatosMetaFooter(analysisResult: AnalysisResult): string {
		const b64 = Buffer.from(JSON.stringify(analysisResult)).toString('base64');
		const chunks = fastChunkString(b64, { size: 78, unicodeAware: false });
		return `\n; ratos_meta begin ${b64.length}\n; ${chunks.join('\n; ')}\n; ratos_meta end ${chunks.length}`;
	}

	/** Factory. Returns GCodeFile with valid `info` or throws if the file header can't be parsed etc. */
	public static async inspect(path: string, options: InspectOptions): Promise<GCodeFile> {
		const onWarning = options?.onWarning;
		const header = await fsReaderGetLines(path, 4);
		const gci = GCodeFile.tryParseHeader(header);

		if (!gci) {
			throw new GCodeProcessorError('No valid G-Code file headers were found, the file cannot be inspected.');
		}

		if (gci.fileLayoutVersion === 2) {
			// NB: gci.ratosMetaFileOffset is set but not used yet. The code below is transitional and will be replaced.

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
						GCODEFILE_WARNING_CODES.INVALID_METADATA,
						'Failed to parse ratos_meta block: the begin marker was not found.',
					);
				} else {
					const expectedBase64CharCount = Number(match[1]);
					const base64str = match[2].replaceAll(/[;\s]/g, '');
					if (base64str.length != expectedBase64CharCount) {
						onWarning?.(
							GCODEFILE_WARNING_CODES.INVALID_METADATA,
							`Failed to parse ratos_meta block: expected ${expectedBase64CharCount} base64 characters, but found ${base64str.length}.`,
						);
					} else {
						const jsonStr = Buffer.from(base64str, 'base64').toString('utf-8');
						// TODO: Versioning
						gci.analysisResult = JSON.parse(jsonStr);
					}
				}
			} else {
				onWarning?.(GCODEFILE_WARNING_CODES.INVALID_METADATA, 'The ratos_meta block was not found.');
			}
		} else if (gci.fileLayoutVersion === 0) {
			const tail = await fsReaderGetLines(path, -3);
			if (/^; processed by RatOS($|\s)/im.test(tail)) {
				gci.processedByRatOSVersion = GCodeFile.LEGACY_RATOS_VERSION;
			}
		}

		return new GCodeFile(path, gci);
	}

	/** If the current file is already processed by the current GCodeHandling version, throws; otherwise, inputFile will be unprocessed on the fly (if already processed) and (re)transformed. */
	public async transform(outputFile: string, options: TransformOptions): Promise<GCodeInfo> {
		let fh: FileHandle | undefined;
		const gcodeProcessor = new GCodeProcessor(options);
		const encoder = new BookmarkingBufferEncoder(undefined, undefined, options.abortSignal);

		try {
			try {
				fh = await open(outputFile, 'w');
				if (options.progressTransform) {
					await pipeline(
						createReadStream(this.path),
						options.progressTransform,
						split(),
						gcodeProcessor,
						encoder,
						createWriteStream('|notused|', { fd: fh.fd, highWaterMark: 256 * 1024, autoClose: false }),
					);
				} else {
					await pipeline(
						createReadStream(this.path),
						split(),
						gcodeProcessor,
						encoder,
						createWriteStream('|notused|', { fd: fh.fd, highWaterMark: 256 * 1024, autoClose: false }),
					);
				}
			} catch (e) {
				if (!(e instanceof InspectionIsComplete)) {
					throw e;
				}
			}

			const s = await fh!.stat();

			const gci = await gcodeProcessor.finalizeProcessing({
				bookmarks: encoder,
				replaceLine: (bm, line) => replaceBookmarkedGcodeLine(fh!, bm, line),
				getProcessedByRatosHeader: (currentCodeVersion, timestamp) =>
					GCodeFile.getProcessedByRatosHeader(currentCodeVersion, timestamp, s.size),
			});

			if (!gci.analysisResult) {
				throw new InternalError('finalizeProcessing did not set analysisResult.');
			}

			await fh!.write(GCodeFile.getRatosMetaFooter(gci.analysisResult));

			return gci;
		} finally {
			try {
				await fh?.close();
			} catch {}
		}
	}

	/** If the current file is already processed by the current GCodeHandling version, returns inputFile.info; otherwise, inputFile will be unprocessed on the fly (if already processed) and (re)analysed. */
	public async analyse(options: AnalyseOptions): Promise<GCodeInfo> {
		const gcodeProcessor = new GCodeProcessor(options);

		try {
			if (options.progressTransform) {
				await pipeline(
					createReadStream(this.path),
					options.progressTransform,
					split(),
					gcodeProcessor,
					new NullSink({ objectMode: true }),
				);
			} else {
				await pipeline(createReadStream(this.path), split(), gcodeProcessor, new NullSink({ objectMode: true }));
			}
		} catch (e) {
			if (!(e instanceof InspectionIsComplete)) {
				throw e;
			}
		}

		return await gcodeProcessor.finalizeProcessing();
	}

	private constructor(
		private readonly path: string,
		public readonly info: GCodeInfo,
	) {}

	/** Reads the file line by line. If the file has already been processed, it will be de-processed on the fly. */
	private readUnprocessedLines(progress?: Transform): Readable {
		throw 'todo';
	}

	/**
	 * Parses header (top of file) comments. This method will not detect files already processed by the legacy Python-based post processor.
	 * @param header One or more newline-separated lines from the start of a gcode file. Normally, at least the first three lines should be provided.
	 */
	static tryParseHeader(header: string): GCodeInfo | null {
		rxGeneratorHeader.lastIndex = 0;
		let match = rxGeneratorHeader.exec(header);

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

			let pbrVersion: SemVer | undefined;
			let pbrTimestamp: Date | undefined;
			let pbrFileLayoutVersion: number = 0;
			let pbrRatosMetaFileOffset: number | undefined;

			rxProcessedByRatosHeader.lastIndex = 0;
			const pbrMatch = rxProcessedByRatosHeader.exec(header);

			if (pbrMatch) {
				pbrVersion = coerceSemVerOrThrow(
					pbrMatch?.groups?.VERSION,
					'The processed by RatOS version is not a valid SemVer.',
				);
				pbrTimestamp = new Date(pbrMatch.groups?.DATE + ' ' + pbrMatch.groups?.TIME);
				pbrFileLayoutVersion = pbrMatch.groups?.V ? Number(pbrMatch.groups?.V) : 1;
				pbrRatosMetaFileOffset = pbrMatch.groups?.M ? parseInt(pbrMatch.groups?.M, 16) : undefined;
			}

			return new GCodeInfo(
				pbrFileLayoutVersion,
				match.groups?.GENERATOR!,
				coerceSemVerOrThrow(match.groups?.VERSION!, 'The generator version is not a valid SemVer.')!,
				flavour,
				new Date(match.groups?.DATE + ' ' + match.groups?.TIME),
				coerceSemVerOrThrow(ratosDialectVersion, 'The RatOS dialect version is not a valid SemVer.'),
				pbrVersion,
				pbrTimestamp,
				undefined,
				pbrRatosMetaFileOffset,
			);
		}

		return null;
	}

	/** Gets the 'Processed by RatOS' header for the current code version. */
	public static getProcessedByRatosHeader(
		currentCodeVersion: semver.SemVer,
		timestamp: Date,
		ratosMetaFileOffset: number,
	): string {
		return `; processed by RatOS ${currentCodeVersion.toString()} on ${date2.format(timestamp, 'YYYY-MM-DD [at] HH:mm:ss [UTC]', true)} v:2 m:${ratosMetaFileOffset.toString(16)}`;
	}
}
