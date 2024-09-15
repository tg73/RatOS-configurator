import { ActionResult, executeActionSequence } from '@/server/gcode-processor/ActionSequence';
import { BookmarkCollection } from '@/server/gcode-processor/BookmarkingBufferEncoder';
import { Bookmark } from '@/server/gcode-processor/Bookmark';
import { ProcessLineContext } from '@/server/gcode-processor/SlidingWindowLineProcessor';
import { InternalError } from '@/server/gcode-processor/GCodeProcessorError';
import { GCodeInfo } from '@/server/gcode-processor/GCodeInfo';
import { State } from '@/server/gcode-processor/State';
import { Action } from '@/server/gcode-processor/Actions';
import * as act from '@/server/gcode-processor/Actions';

// Reminder: this is a typeguard.
function isActionFunction(x: unknown): x is (c: ProcessLineContext, s: State) => ActionResult | void {
	return true;
}

export class RatOSGcodeProcessor {
	constructor(printerHasIdex: boolean, printerHasRmmuHub: boolean, inspectionOnly: boolean) {
		this.#state = new State(printerHasIdex, printerHasRmmuHub, inspectionOnly);
	}

	#state: State;
	/**
	 * NB: The order of actions is significant.
	 */
	#actions: Action[] = [
		act.getGcodeInfo,
		act.getStartPrint, // NB: sequence won't execute past here until start line is found.
		act.fixOtherLayerTemperature,
		act.fixOrcaSetAccelaration,
		act.parseCommonCommands,
		act.findFirstMoveXY,
		act.findMinMaxX,
		act.processToolchange,
	];

	processLine(ctx: ProcessLineContext) {
		this.#state.resetIterationState();
		++this.#state.currentLineNumber;

		executeActionSequence(this.#actions, (action: Action) => {
			if (isActionFunction(action)) {
				let result = action(ctx, this.#state);
				return result === undefined ? ActionResult.Continue : result;
			} else {
				if (this.#state.gcodeInfoOrUndefined === undefined) {
					// We can't do anything with a flavour-filtered action until the flavour is known.
					return ActionResult.Continue;
				} else {
					if ((this.#state.gcodeInfoOrUndefined.flavour & action[0]) > 0) {
						let result = action[1](ctx, this.#state);
						return result === undefined ? ActionResult.Continue : result;
					} else {
						// Flavour is not a match, remove.
						return ActionResult.RemoveAndContinue;
					}
				}
			}
		});
	}

	/**
	 * TODO
	 * @param bookmarks
	 */
	async processBookmarks(
		bookmarks: BookmarkCollection,
		replaceLine: (bookmark: Bookmark, line: string) => Promise<void>,
	) {
		// TODO: apply boookmarks. If a file is only being inspected, BookmarkingBufferEncoder won't
		// be in the pipeline, and it would be pointless to call this method. This is also expressed
		// via State.kInspectionOnly: most processing code will behave the same regardless, but this
		// flag can be used to skip some expensive mutation that won't end up being used anyhow.
		if (this.#state.firstLine) {
			await replaceLine(
				bookmarks.getBookmark(this.#state.firstLine.bookmark),
				this.#state.firstLine.line.trimEnd() + '\n' + (await GCodeInfo.getProcessedByRatosHeader()),
			);
		}
	}

	/**
	 * TODO
	 */
	getSidecarData(): Object {
		// TODO: This can be called at the end of both inspection and mutation pipelines to emit sidecar
		// data. For inspection pipelines, this is the only way to emit the results of the analysis.
		// For mutating pipelines, some data is also extracted for UI use, such as filament information
		// or toolchange timings.
		throw new InternalError('not implemented');
	}
}
