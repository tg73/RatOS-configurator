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

export function executeActionSequence<TAction>(actions: TAction[], invoke: (action: TAction) => ActionResult) {
	let idx = 0;
	while (idx < actions.length) {
		switch (invoke(actions[idx])) {
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

export async function executeActionSequenceAsync<TAction>(
	actions: TAction[],
	invoke: (action: TAction) => Promise<ActionResult>,
): Promise<void> {
	let idx = 0;
	while (idx < actions.length) {
		switch (await invoke(actions[idx])) {
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
