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

import { AnalysisResult } from '@/server/gcode-processor/GCodeProcessor';
import { existsSync } from 'node:fs';
import { access, constants, stat } from 'node:fs/promises';
import path from 'node:path';
import progress from 'progress-stream';
import { Transform } from 'node:stream';
import { SerializedGcodeInfo } from '@/server/gcode-processor/GCodeInfo';
import { GCodeFile } from '@/server/gcode-processor/GCodeFile';

export const PROGRESS_STREAM_SPEED_STABILIZATION_TIME = 3;

type ProcessorResult = SerializedGcodeInfo & {
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

	const gcfOptions = {
		printerHasIdex: options.idex,
		allowUnsupportedSlicerVersions: options.allowUnsupportedSlicerVersions,
		quickInspectionOnly: false,
		abortSignal: options.abortSignal,
		onWarning: options.onWarning,
	};

	const gcf = await GCodeFile.inspect(inputFile, gcfOptions);

	if (gcf.info.processedByRatOSVersion) {
		return {
			...gcf.info.serialize(),
			wasAlreadyProcessed: true,
		};
	}

	let progressStream: Transform | undefined;

	if (options.onProgress) {
		progressStream = progress({ length: inputStat.size });
		progressStream.on('progress', options.onProgress);
	}

	return {
		...(await gcf.analyse({ progressTransform: progressStream, ...gcfOptions })).serialize(),
		wasAlreadyProcessed: false,
	};
}

export async function processGCode(
	inputFile: string,
	outputFile: string,
	options: ProcessOptions,
): Promise<ProcessorResult> {
	const gcfOptions = {
		printerHasIdex: options.idex,
		allowUnsupportedSlicerVersions: options.allowUnsupportedSlicerVersions,
		abortSignal: options.abortSignal,
		onWarning: options.onWarning,
	};

	const inputStat = await stat(path.resolve(inputFile));
	const outPath = path.resolve(path.dirname(outputFile));
	if (!inputStat.isFile()) {
		throw new Error(`${inputFile} is not a file`);
	}

	const gcf = await GCodeFile.inspect(inputFile, gcfOptions);

	if (gcf?.info.processedByRatOSVersion) {
		return {
			...gcf.info.serialize(),
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

	let progressStream: Transform | undefined;

	if (options.onProgress) {
		progressStream = progress({ length: inputStat.size, speed: PROGRESS_STREAM_SPEED_STABILIZATION_TIME });
		progressStream.on('progress', options.onProgress);
	}

	return {
		...(await gcf.transform(outputFile, { progressTransform: progressStream, ...gcfOptions })).serialize(),
		wasAlreadyProcessed: false,
	};
}
