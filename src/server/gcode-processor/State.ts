import { GCodeInfo } from '@/server/gcode-processor/GCodeInfo';
import { InternalError } from '@/server/gcode-processor/GCodeProcessorError';
import { BookmarkKey } from '@/server/gcode-processor/Bookmark';

// Logically atomic.
export class BookmarkedLine {
	constructor(
		public readonly line: string,
		public readonly bookmark: BookmarkKey,
	) {}
}

/**
 * Property naming convention:
 *  'k' prefix: external configuration. Always readonly.
 *  '_' prefix: iteration-scope state that gets reset for each line
 *   no prefix: file-scope state that is maintained for the whole file
 */
export class State {
	constructor(
		public readonly kPrinterHasIdex: boolean,
		public readonly kPrinterHasRmmuHub: boolean,
		public readonly kInpsectionOnly: boolean,
	) {}

	// Stream-scope fields:
	public currentLineNumber: number = -1;
	public firstLine?: BookmarkedLine;
	public startPrintLine?: BookmarkedLine;
	public onLayerChange2Bookmark?: symbol;
	public extruderTemps?: string[];
	public toolChangeCount = 0;
	public firstMoveX?: string;
	public firstMoveY?: string;
	public minX = Number.MAX_VALUE;
	public maxX = Number.MIN_VALUE;
	public hasPurgeTower?: boolean;

	/** Used tools, in order of first use. */
	public usedTools: number[] = [];

	// Iteration-scope fields (reset at the start of each processLine iteration):
	public _cmd?: RegExpExecArray | null;

	/**
	 * Resets iteration-scope state.
	 */
	resetIterationState() {
		this._cmd = undefined;
	}

	#gcodeInfo?: GCodeInfo;

	/**
	 * `gcodeInfo` is always set near the start of processing and is accessed frequently
	 * so provide a non-optional accessor for convenience.
	 */
	get gcodeInfo(): GCodeInfo {
		if (!this.#gcodeInfo) {
			throw new InternalError('gcodeInfo has not been set yet.');
		}
		return this.#gcodeInfo;
	}

	set gcodeInfo(value: GCodeInfo) {
		this.#gcodeInfo = value;
	}

	get gcodeInfoOrUndefined(): GCodeInfo | undefined {
		return this.#gcodeInfo;
	}
}
