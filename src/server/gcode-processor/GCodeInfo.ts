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

import { SemVer } from 'semver';
import fsReader from '@/server/helpers/fs-reader.js';
import util from 'node:util';
import { AnalysisResult } from '@/server/gcode-processor/AnalysisResult';
import { InternalError } from '@/server/gcode-processor/errors';

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
	flavour: string;
	generatorTimestamp: string;
	ratosDialectVersion?: string;
	processedByRatOSVersion?: string;
	processedByRatOSTimestamp?: string;
	/** If a file has been processed, by a compatible version, the result of analysing the file. */
	analysisResult?: AnalysisResult;
}

export type GCodeInfo = Readonly<MutableGCodeInfo>;

/** Characteristics of a G-code file, typically determined from the header lines of the file. */
export class MutableGCodeInfo {
	constructor(
		public generator: string,
		public generatorVersion: SemVer,
		public flavour: GCodeFlavour,
		public generatorTimestamp: Date,
		public ratosDialectVersion?: SemVer,
		public processedByRatOSVersion?: SemVer,
		public processedByRatOSTimestamp?: Date,
		public analysisResult?: AnalysisResult,
		/** undefined = unprocessed or partially initialized, 0 = legacy PBR footer, 1 = pre-release, 2 = beta transitional version, 3 = adds 'kind' for better zod handling */
		public fileFormatVersion?: number,
		public ratosMetaFileOffset?: number,
		public processedForIdex?: boolean,
	) {}

	public get isProcessed(): boolean {
		if (this.fileFormatVersion === undefined && this.processedByRatOSVersion === undefined) {
			return false;
		} else if (this.fileFormatVersion !== undefined && this.processedByRatOSVersion !== undefined) {
			return true;
		} else {
			throw new InternalError('The fields defining isProcessed are inconsistent.');
		}
	}

	public toJSON(): string {
		return JSON.stringify(this.serialize());
	}

	public serialize(): SerializedGcodeInfo {
		return {
			generator: this.generator,
			generatorVersion: this.generatorVersion.toString(),
			flavour: GCodeFlavour[this.flavour],
			generatorTimestamp: this.generatorTimestamp.toISOString(),
			ratosDialectVersion: this.ratosDialectVersion?.toString(),
			processedByRatOSVersion: this.processedByRatOSVersion?.toString(),
			processedByRatOSTimestamp: this.processedByRatOSTimestamp?.toISOString(),
			analysisResult: this.analysisResult,
		};
	}
}
