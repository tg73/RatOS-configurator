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
	Continue,
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
}

/** Execute an action sequence. */
export function executeActionSequence<TAction>(
	actions: TAction[],
	invoke: (action: TAction) => ActionResult | [result: ActionResult, replaceWith: TAction],
) {
	let idx = 0;
	while (idx < actions.length) {
		const ret = invoke(actions[idx]);
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
