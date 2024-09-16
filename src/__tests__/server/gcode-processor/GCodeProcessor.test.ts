/**
 * @file GCodeProcessor.test.ts
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

import { describe, test, expect, should } from 'vitest';
import { GCodeProcessor } from '@/server/gcode-processor/GCodeProcessor';
import { GCodeFlavour, GCodeInfo } from '@/server/gcode-processor/GCodeInfo';
import semver from 'semver';
import { InternalError } from '@/server/gcode-processor/errors';

describe('satisfiesFilter', async () => {
	test('simple match', () => {
		const gcodeInfo = new GCodeInfo('PrusaSlicer', semver.coerce('2.8')!, GCodeFlavour.PrusaSlicer, new Date());
		const match = GCodeProcessor['satisfiesFilter'](gcodeInfo, GCodeFlavour.PrusaSlicer);
		expect(match).toStrictEqual(true);
	});

	test('simple match 2-or', () => {
		const gcodeInfo = new GCodeInfo('PrusaSlicer', semver.coerce('2.8')!, GCodeFlavour.PrusaSlicer, new Date());
		const match = GCodeProcessor['satisfiesFilter'](gcodeInfo, GCodeFlavour.PrusaSlicer | GCodeFlavour.OrcaSlicer);
		expect(match).toStrictEqual(true);
	});

	test('simple not-match', () => {
		const gcodeInfo = new GCodeInfo('PrusaSlicer', semver.coerce('2.8')!, GCodeFlavour.PrusaSlicer, new Date());
		const match = GCodeProcessor['satisfiesFilter'](gcodeInfo, GCodeFlavour.OrcaSlicer);
		expect(match).toStrictEqual(false);
	});

	test('version match 1', () => {
		const gcodeInfo = new GCodeInfo('PrusaSlicer', semver.coerce('2.8')!, GCodeFlavour.PrusaSlicer, new Date());
		const match = GCodeProcessor['satisfiesFilter'](gcodeInfo, [GCodeFlavour.PrusaSlicer, '>2.1']);
		expect(match).toStrictEqual(true);
	});

	test('version match 2', () => {
		const gcodeInfo = new GCodeInfo('PrusaSlicer', semver.coerce('2.8')!, GCodeFlavour.PrusaSlicer, new Date());
		const match = GCodeProcessor['satisfiesFilter'](gcodeInfo, [
			[GCodeFlavour.OrcaSlicer, '>5.9'],
			[GCodeFlavour.PrusaSlicer, '>2.1'],
		]);
		expect(match).toStrictEqual(true);
	});

	test('version not-match 1', () => {
		const gcodeInfo = new GCodeInfo('PrusaSlicer', semver.coerce('1.8')!, GCodeFlavour.PrusaSlicer, new Date());
		const match = GCodeProcessor['satisfiesFilter'](gcodeInfo, [GCodeFlavour.PrusaSlicer, '>2.1']);
		expect(match).toStrictEqual(false);
	});

	test('version not-match 2', () => {
		const gcodeInfo = new GCodeInfo('PrusaSlicer', semver.coerce('1.8')!, GCodeFlavour.PrusaSlicer, new Date());
		const match = GCodeProcessor['satisfiesFilter'](gcodeInfo, [
			[GCodeFlavour.OrcaSlicer, '>5.9'],
			[GCodeFlavour.PrusaSlicer, '>2.1'],
		]);
		expect(match).toStrictEqual(false);
	});

	test('match GCodeFlavour.Unknown should throw', () => {
		const gcodeInfo = new GCodeInfo('PrusaSlicer', semver.coerce('2.8')!, GCodeFlavour.PrusaSlicer, new Date());
		expect(() => {
			GCodeProcessor['satisfiesFilter'](gcodeInfo, GCodeFlavour.Unknown);
		}).toThrow(InternalError);
	});

	test('version match GCodeFlavour.Unknown should throw', () => {
		const gcodeInfo = new GCodeInfo('PrusaSlicer', semver.coerce('2.8')!, GCodeFlavour.PrusaSlicer, new Date());
		expect(() => {
			GCodeProcessor['satisfiesFilter'](gcodeInfo, [GCodeFlavour.Unknown, '>2.1']);
		}).toThrow(InternalError);
	});

	test('version match two bits should throw', () => {
		const gcodeInfo = new GCodeInfo('PrusaSlicer', semver.coerce('2.8')!, GCodeFlavour.PrusaSlicer, new Date());
		expect(() => {
			GCodeProcessor['satisfiesFilter'](gcodeInfo, [GCodeFlavour.PrusaSlicer | GCodeFlavour.OrcaSlicer, '>2.1']);
		}).toThrow(InternalError);
	});
});
