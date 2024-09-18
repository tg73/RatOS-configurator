/**
 * @file ActionSequence.ts
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

/** The result of executing an action in an action sequence. */
export enum ActionResult {
	/**
	 * Continue processing subsequent actions in the sequence.
	 */
	Continue = 0,
	/**
	 * Remove the current action, then continue processing subsequent actions in the sequence.
	 */
	RemoveAndContinue,
	/**
	 * Do not process any subsequent actions in the sequence.
	 */
	Stop,
	/**
	 * Remove the current action, and not process any subsequent actions in the sequence.
	 */
	RemoveAndStop,

	/**
	 * A flag that can be or'd with one of the non-flag values when an action is a subsequence entry
	 * action (the first item in a subsequence tuple). {@link SkipSubsequence} indicates that the
	 * the subsequence array should not be processed. If this flag is not set, the subsequence
	 * will be processed regardless of the main {@link ActionResult} value.
	 *
	 * Note that {@link SkipSubsequence} on its own is equivalent to
	 * {@link SkipSubsequence}` | `{@link Continue}, because {@link Continue} has value `0`.
	 */
	SkipSubsequence = 1 << 8,
}

const kActionResultNonFlagMask = (1 << 8) - 1;

export class ActionSubSequence<TAction> {
	constructor(
		public readonly entryAction: TAction,
		public readonly sequence: TAction[],
	) {}
}

export function subSequence<TAction>(entryAction: TAction, sequence: TAction[]) {
	return new ActionSubSequence<TAction>(entryAction, sequence);
}

export type ActionSequence<TAction> = Array<TAction | ActionSubSequence<TAction>>;

/** Execute an action sequence. */
export function executeActionSequence<TAction>(
	actions: ActionSequence<TAction>,
	invoke: (action: TAction) => ActionResult | [result: ActionResult, replaceWith: TAction],
) {
	let idx = 0;
	while (idx < actions.length) {
		let item = actions[idx];

		let action: TAction | undefined = undefined;
		let subseq: TAction[] | undefined = undefined;
		let ret: ActionResult | [result: ActionResult, replaceWith: TAction] | undefined = undefined;

		if (item instanceof ActionSubSequence) {
			action = item.entryAction;
			subseq = item.sequence;
		} else {
			action = item;
		}

		ret = invoke(action);

		let result: ActionResult;

		if (Array.isArray(ret)) {
			result = ret[0];
			actions[idx] = ret[1];
		} else {
			result = ret;
		}

		if (subseq && (result & ActionResult.SkipSubsequence) == 0) {
			executeActionSequence(subseq, invoke);
		}

		switch (result & kActionResultNonFlagMask) {
			case ActionResult.Continue:
				++idx;
				break;
			case ActionResult.Stop:
				return;
			case ActionResult.RemoveAndContinue:
				actions.splice(idx, 1);
				break;
			case ActionResult.RemoveAndStop:
				actions.splice(idx, 1);
				return;
		}
	}
}

/** Execute an action sequence asynchronously. */
export async function executeActionSequenceAsync<TAction>(
	actions: TAction[],
	invoke: (action: TAction) => Promise<ActionResult | [result: ActionResult, replaceWith: TAction]>,
): Promise<void> {
	let idx = 0;
	while (idx < actions.length) {
		const ret = await invoke(actions[idx]);
		let result: ActionResult;
		if (Array.isArray(ret)) {
			result = ret[0];
			actions[idx] = ret[1];
		} else {
			result = ret;
		}
		switch (result) {
			case ActionResult.Continue:
				++idx;
				break;
			case ActionResult.Stop:
				return;
			case ActionResult.RemoveAndContinue:
				actions.splice(idx, 1);
				break;
			case ActionResult.RemoveAndStop:
				actions.splice(idx, 1);
				return;
		}
	}
}
