/**
 * @file gcode-processor.ts
 * @description Public API of the RatOS gcode post-processor.
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

/**
 * NOTE: Incomplete, API requirements to be determined.
 */

import { AnalysisResult, GCodeProcessor, InspectionIsComplete } from '@/server/gcode-processor/GCodeProcessor';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { FileHandle, access, constants, stat, open } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import progress from 'progress-stream';
import split from 'split2';
import {
	BookmarkingBufferEncoder,
	replaceBookmarkedGcodeLine,
} from '@/server/gcode-processor/BookmarkingBufferEncoder';
import { Writable } from 'node:stream';
import { GCodeInfo } from '@/server/gcode-processor/GCodeInfo';

export const PROGRESS_STREAM_SPEED_STABILIZATION_TIME = 3;

class NullSink extends Writable {
	_write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
		callback();
	}
}

type ProcessorResult = AnalysisResult & {
	wasAlreadyProcessed: boolean;
};

interface CommonOptions {
	idex?: boolean;
	overwrite?: boolean;
	allowUnsupportedSlicerVersions?: boolean;
	onProgress?: (report: progress.Progress) => void;
	onWarning?: (code: string, message: string) => void;
	abortSignal?: AbortSignal;
}

interface ProcessOptions extends CommonOptions {
	overwrite?: boolean;
}

interface InspectOptions extends CommonOptions {
	/**
	 * If true, the whole file is examined, and a full {@link AnalysisResult} is built. Otherwise,
	 * a quick inspection is performed, and at most the `gcodeInfo`, `firstMoveX` and `firstMoveY`
	 * fields will be populated.
	 */
	fullInspection?: boolean;
}

export async function inspectGCode(inputFile: string, options: InspectOptions): Promise<ProcessorResult> {
	const inputStat = await stat(path.resolve(inputFile));
	if (!inputStat.isFile()) {
		throw new Error(`${inputFile} is not a file`);
	}

	const gcInfoBeforeProcessing = await GCodeInfo.fromFile(inputFile);

	if (gcInfoBeforeProcessing?.processedByRatOSVersion) {
		return {
			gcodeInfo: gcInfoBeforeProcessing.serialize(),
			wasAlreadyProcessed: true,
		};
	}

	const gcodeProcessor = new GCodeProcessor({
		printerHasIdex: options.idex,
		allowUnsupportedSlicerVersions: options.allowUnsupportedSlicerVersions,
		quickInspectionOnly: !options.fullInspection,
		abortSignal: options.abortSignal,
		onWarning: options.onWarning,
	});
	const progressStream = progress({ length: inputStat.size });
	if (options.onProgress) {
		progressStream.on('progress', options.onProgress);
	}
	try {
		await pipeline(
			createReadStream(inputFile),
			progressStream,
			split(),
			gcodeProcessor,
			new NullSink({ objectMode: true }),
		);
	} catch (e) {
		if (e instanceof InspectionIsComplete) {
			return {
				...gcodeProcessor.getAnalysisResult(),
				wasAlreadyProcessed: false,
			};
		}
		throw e;
	}
	return {
		...gcodeProcessor.getAnalysisResult(),
		wasAlreadyProcessed: false,
	};
}

export async function processGCode(
	inputFile: string,
	outputFile: string,
	options: ProcessOptions,
): Promise<ProcessorResult> {
	let fh: FileHandle | undefined = undefined;
	const inputStat = await stat(path.resolve(inputFile));
	const outPath = path.resolve(path.dirname(outputFile));
	if (!inputStat.isFile()) {
		throw new Error(`${inputFile} is not a file`);
	}

	const gcInfoBeforeProcessing = await GCodeInfo.fromFile(inputFile);

	if (gcInfoBeforeProcessing?.processedByRatOSVersion) {
		return {
			gcodeInfo: gcInfoBeforeProcessing.serialize(),
			wasAlreadyProcessed: true,
		};
	}

	try {
		await access(outPath, constants.W_OK);
	} catch (e) {
		throw new Error(`${outPath} is not a writable directory`);
	}
	if (existsSync(path.resolve(outputFile)) && !options.overwrite) {
		throw new Error(`${outputFile} already exists`);
	}
	try {
		fh = await open(outputFile, 'w');
		const gcodeProcessor = new GCodeProcessor({
			printerHasIdex: options.idex,
			allowUnsupportedSlicerVersions: options.allowUnsupportedSlicerVersions,
			quickInspectionOnly: false,
			abortSignal: options.abortSignal,
			onWarning: options.onWarning,
		});
		const encoder = new BookmarkingBufferEncoder(undefined, undefined, options.abortSignal);
		const progressStream = progress({ length: inputStat.size, speed: PROGRESS_STREAM_SPEED_STABILIZATION_TIME });
		if (options.onProgress) {
			progressStream.on('progress', options.onProgress);
		}
		await pipeline(
			createReadStream(inputFile),
			progressStream,
			split(),
			gcodeProcessor,
			encoder,
			createWriteStream('|notused|', { fd: fh.fd, highWaterMark: 256 * 1024, autoClose: false }),
		);

		await gcodeProcessor.processBookmarks(encoder, (bm, line) => replaceBookmarkedGcodeLine(fh!, bm, line));

		return {
			...gcodeProcessor.getAnalysisResult(),
			wasAlreadyProcessed: false,
		};
	} finally {
		try {
			await fh?.close();
		} catch {}
	}
}
