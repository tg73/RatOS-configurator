/**
 * @file GCodeProcessor.ts
 * @description The RatOS gcode post-processor.
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

import { ActionResult, executeActionSequence } from '@/server/gcode-processor/ActionSequence';
import { BookmarkCollection } from '@/server/gcode-processor/BookmarkingBufferEncoder';
import { Bookmark } from '@/server/gcode-processor/Bookmark';
import { ProcessLineContext } from '@/server/gcode-processor/SlidingWindowLineProcessor';
import { InternalError } from '@/server/gcode-processor/errors';
import { GCodeFlavour, GCodeInfo } from '@/server/gcode-processor/GCodeInfo';
import { State } from '@/server/gcode-processor/State';
import { exactlyOneBitSet } from '@/server/gcode-processor/helpers';
import { Action, ActionFilter } from '@/server/gcode-processor/Actions';
import * as act from '@/server/gcode-processor/Actions';

// Reminder: this is a typeguard.
function isActionFunction(x: unknown): x is (c: ProcessLineContext, s: State) => ActionResult | void {
	return true;
}

export class GcodeProcessor {
	constructor(printerHasIdex: boolean, printerHasRmmuHub: boolean, inspectionOnly: boolean) {
		this.#state = new State(printerHasIdex, printerHasRmmuHub, inspectionOnly);
	}

	#state: State;

	// NB: The order of actions is significant.
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

		executeActionSequence(this.#actions, (action: Action) => GcodeProcessor.invokeAction(action, ctx, this.#state));
	}

	// NB: Static for easier unit testing.
	/**
	 * Wraps action invocation with additional {@link GcodeProcessor}-specific convenience logic.
	 *  * The action function can return `ActionResult | void`, where `void` is equivalent to
	 *    {@link ActionResult.Continue}.
	 *  * Some union alterates of the {@link Action} type allow common relevance filters to be
	 *    expressed declaritively (currently by {@link GCodeFlavour}).
	 * */
	private static invokeAction(action: Action, ctx: ProcessLineContext, state: State): ActionResult {
		if (isActionFunction(action)) {
			// It's a plain action, no filter.
			let result = action(ctx, state);
			return result === undefined ? ActionResult.Continue : result;
		} else {
			if (state.gcodeInfoOrUndefined === undefined) {
				// We can't do anything with a flavour-filtered action until the flavour is known.
				return ActionResult.Continue;
			} else {
				if (Array.isArray(action[0])) {
					action[0].flat(Infinity);
				}
				if ((state.gcodeInfoOrUndefined.flavour & action[0]) > 0) {
					let result = action[1](ctx, state);
					return result === undefined ? ActionResult.Continue : result;
				} else {
					// Flavour is not a match, remove.
					return ActionResult.RemoveAndContinue;
				}
			}
		}
	}

	private static stateSatisfiesFilter(state: State, include: ActionFilter | ActionFilter[]): boolean | undefined {
		if (state.gcodeInfoOrUndefined === undefined) {
			return undefined;
		}

		const flat = Array.isArray(include) ? include.flat(Infinity) : [include];

		for (let i = 0; i < flat.length; ++i) {
			const flavour = flat[i] as GCodeFlavour;
			if (typeof flat[i + 1] === 'string') {
				if (!exactlyOneBitSet(flavour)) {
					throw new InternalError(
						'An ActionFilter with semVerRange specified must specify exactly one GCodeFlavour to which the filter applies.',
					);
				}
				const semVerRange = flat[i+1];
				
			}
		}
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
