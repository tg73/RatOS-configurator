/**
 * @file ActionSequence.test.ts
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

import { describe, test, expect } from 'vitest';
import {
	ActionResult,
	executeActionSequence,
	executeActionSequenceAsync,
} from '@/server/gcode-processor/ActionSequence';

type TestActionResult = ActionResult | [ActionResult, TestAction];
type TestAction = [id: string, result: TestActionResult];

describe('ActionSequence', async () => {
	test('continue', () => {
		let log: string[] = [];
		const fixture: TestAction[] = [
			['A', ActionResult.Continue],
			['B', ActionResult.Continue],
			['C', ActionResult.Continue],
		];
		const actions = fixture.concat();
		const invoke = (act: [id: string, result: TestActionResult]) => {
			log.push(act[0]);
			return act[1];
		};
		executeActionSequence(actions, invoke);
		expect(log).toEqual(['A', 'B', 'C']);
		expect(actions).toEqual(fixture);
	});

	test('stop', () => {
		let log: string[] = [];
		const fixture: TestAction[] = [
			['A', ActionResult.Continue],
			['B', ActionResult.Stop],
			['C', ActionResult.Continue],
		];
		const actions = fixture.concat();
		const invoke = (act: [id: string, result: TestActionResult]) => {
			log.push(act[0]);
			return act[1];
		};
		executeActionSequence(actions, invoke);
		expect(log).toEqual(['A', 'B']);
		expect(actions).toEqual(fixture);
	});

	test('remove and stop', () => {
		let log: string[] = [];
		const fixture: TestAction[] = [
			['A', ActionResult.Continue],
			['B', ActionResult.RemoveAndStop],
			['C', ActionResult.Continue],
		];
		const actions = fixture.concat();
		const invoke = (act: [id: string, result: TestActionResult]) => {
			log.push(act[0]);
			return act[1];
		};
		executeActionSequence(actions, invoke);
		expect(log).toEqual(['A', 'B']);
		expect(actions).toEqual([
			['A', ActionResult.Continue],
			['C', ActionResult.Continue],
		]);
	});

	test('remove and continue', () => {
		let log: string[] = [];
		const fixture: TestAction[] = [
			['A', ActionResult.Continue],
			['B', ActionResult.RemoveAndContinue],
			['C', ActionResult.Continue],
		];
		const actions = fixture.concat();
		const invoke = (act: [id: string, result: TestActionResult]) => {
			log.push(act[0]);
			return act[1];
		};
		executeActionSequence(actions, invoke);
		expect(log).toEqual(['A', 'B', 'C']);
		expect(actions).toEqual([
			['A', ActionResult.Continue],
			['C', ActionResult.Continue],
		]);
	});

	test('replace and continue', () => {
		let log: string[] = [];
		const fixture: TestAction[] = [
			['A', ActionResult.Continue],
			['B', [ActionResult.Continue, ['X', ActionResult.Continue]]],
			['C', ActionResult.Continue],
		];
		const actions = fixture.concat();
		const invoke = (act: [id: string, result: TestActionResult]) => {
			log.push(act[0]);
			return act[1];
		};
		executeActionSequence(actions, invoke);
		expect(log).toEqual(['A', 'B', 'C']);
		expect(actions).toEqual([
			['A', ActionResult.Continue],
			['X', ActionResult.Continue],
			['C', ActionResult.Continue],
		]);
	});

	test('stop', () => {
		let log: string[] = [];
		const fixture: TestAction[] = [
			['A', ActionResult.Continue],
			['B', ActionResult.Stop],
			['C', ActionResult.Continue],
		];
		const actions = fixture.concat();
		const invoke = (act: [id: string, result: TestActionResult]) => {
			log.push(act[0]);
			return act[1];
		};
		executeActionSequence(actions, invoke);
		expect(log).toEqual(['A', 'B']);
		expect(actions).toEqual(fixture);
	});

	// -------------------------------------------

	test('continue async', async () => {
		let log: string[] = [];
		const fixture: TestAction[] = [
			['A', ActionResult.Continue],
			['B', ActionResult.Continue],
			['C', ActionResult.Continue],
		];
		const actions = fixture.concat();
		const invoke = async (act: [id: string, result: TestActionResult]) => {
			log.push(act[0]);
			return act[1];
		};
		await executeActionSequenceAsync(actions, invoke);
		expect(log).toEqual(['A', 'B', 'C']);
		expect(actions).toEqual(fixture);
	});

	test('replace and continue async', async () => {
		let log: string[] = [];
		const fixture: TestAction[] = [
			['A', ActionResult.Continue],
			['B', [ActionResult.Continue, ['X', ActionResult.Continue]]],
			['C', ActionResult.Continue],
		];
		const actions = fixture.concat();
		const invoke = async (act: [id: string, result: TestActionResult]) => {
			log.push(act[0]);
			return act[1];
		};
		await executeActionSequenceAsync(actions, invoke);
		expect(log).toEqual(['A', 'B', 'C']);
		expect(actions).toEqual([
			['A', ActionResult.Continue],
			['X', ActionResult.Continue],
			['C', ActionResult.Continue],
		]);
	});

	test('stop async', async () => {
		let log: string[] = [];
		const fixture: TestAction[] = [
			['A', ActionResult.Continue],
			['B', ActionResult.Stop],
			['C', ActionResult.Continue],
		];
		const actions = fixture.concat();
		const invoke = async (act: [id: string, result: TestActionResult]) => {
			log.push(act[0]);
			return act[1];
		};
		await executeActionSequenceAsync(actions, invoke);
		expect(log).toEqual(['A', 'B']);
		expect(actions).toEqual(fixture);
	});

	test('remove and stop async', async () => {
		let log: string[] = [];
		const fixture: TestAction[] = [
			['A', ActionResult.Continue],
			['B', ActionResult.RemoveAndStop],
			['C', ActionResult.Continue],
		];
		const actions = fixture.concat();
		const invoke = async (act: [id: string, result: TestActionResult]) => {
			log.push(act[0]);
			return act[1];
		};
		await executeActionSequenceAsync(actions, invoke);
		expect(log).toEqual(['A', 'B']);
		expect(actions).toEqual([
			['A', ActionResult.Continue],
			['C', ActionResult.Continue],
		]);
	});

	test('remove and continue async', async () => {
		let log: string[] = [];
		const fixture: TestAction[] = [
			['A', ActionResult.Continue],
			['B', ActionResult.RemoveAndContinue],
			['C', ActionResult.Continue],
		];
		const actions = fixture.concat();
		const invoke = async (act: [id: string, result: TestActionResult]) => {
			log.push(act[0]);
			return act[1];
		};
		await executeActionSequenceAsync(actions, invoke);
		expect(log).toEqual(['A', 'B', 'C']);
		expect(actions).toEqual([
			['A', ActionResult.Continue],
			['C', ActionResult.Continue],
		]);
	});

	// ---------------------------------------

	test('remove and continue all', async () => {
		let log: string[] = [];
		const fixture: TestAction[] = [
			['A', ActionResult.RemoveAndContinue],
			['B', ActionResult.RemoveAndContinue],
			['C', ActionResult.RemoveAndContinue],
		];
		const actions = fixture.concat();
		const invoke = (act: [id: string, result: TestActionResult]) => {
			log.push(act[0]);
			return act[1];
		};
		executeActionSequence(actions, invoke);
		expect(log).toEqual(['A', 'B', 'C']);
		expect(actions.length).toEqual(0);
	});
});
