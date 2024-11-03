/**
 * @file Actions.ts
 * @description
 *
 * @author Tom Glastonbury <t@tg73.net>
 * @author Portions originally ported from Python code authored by Helge Keck <helgekeck@hotmail.com>
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

import { ActionResult } from '@/server/gcode-processor/ActionSequence';
import { ProcessLineContext } from '@/server/gcode-processor/SlidingWindowLineProcessor';
import semver from 'semver';
import {
	InternalError,
	GCodeError,
	SlicerIdentificationNotFound,
	AlreadyProcessedError,
	SlicerNotSupported,
} from '@/server/gcode-processor/errors';
import { GCodeInfo, GCodeFlavour } from '@/server/gcode-processor/GCodeInfo';
import { State, BookmarkedLine } from '@/server/gcode-processor/State';
import { parseCommonGCodeCommandLine } from '@/server/gcode-processor/CommonGCodeCommand';
import { InspectionIsComplete } from '@/server/gcode-processor/GCodeProcessor';

// TODO: Review pad lengths.

/*
GCODE FORMAT NOTES
------------------
gcode in the wild includes the comment suffix with no leading whitespace. Example from orcaslicer:

SET_PRESSURE_ADVANCE ADVANCE=0.03; Override pressure advance value

*/

export const CHANGED_BY_RATOS = ' ; Changed by RatOS post processor: ';
export const REMOVED_BY_RATOS = '; Removed by RatOS post processor: ';

export enum ACTION_ERROR_CODES {
	UNSUPPORTED_SLICER_VERSION = 'UNSUPPORTED_SLICER_VERSION',
}

/**
 * Either:
 * * {@link GCodeFlavour} - one or more G-code flavours to which the aciton applies (or'd together), regardless of generator or dialect version.
 * * `[flavour: `{@link GCodeFlavour}`, semVerRange: string]` - a (single) G-code flavour and the generator or dialect version range to which
 *   the action applies. If `flavour` is {@link GCodeFlavour.RatOS}, then then {@link GCodeInfo.ratosDialectVersion} is compared, otherwise
 *   {@link GCodeInfo.generatorVersion} is compared.
 */
export type ActionFilter = GCodeFlavour | [flavour: GCodeFlavour, semVerRange: string];

/**
 * For the function return value `ActionResult | void`, `void` is equivalent to `ActionResult.Continue`.
 * The array form of the `include: ActionFilter | ActionFilter[]` parameter expresses a list of inclusion
 * criteria which are or'd together: if any filter is a match, the action is included; if no filters match,
 * the action is not included.
 */
export type Action =
	| ((c: ProcessLineContext, s: State) => ActionResult | [result: ActionResult, replaceWith: Action] | void)
	| [
			include: ActionFilter | ActionFilter[],
			(c: ProcessLineContext, s: State) => ActionResult | [result: ActionResult, replaceWith: Action] | void,
	  ];

export function newGCodeError(message: string, ctx: ProcessLineContext, state: State) {
	return new GCodeError(message, ctx.line, state.currentLineNumber);
}

// export const test1: Action = [GCodeFlavour.OrcaSlicer, (c, s) => {}];
// export const test2: Action = [[GCodeFlavour.OrcaSlicer, '1.0.0'], (c, s) => {}];
// export const test3: Action = [
// 	[
// 		[GCodeFlavour.OrcaSlicer, '1.0.0'],
// 		[GCodeFlavour.PrusaSlicer, '>2.8'],
// 	],
// 	(c, s) => {},
// ];

export const getGcodeInfo: Action = (c, s) => {
	const parsed = GCodeInfo.tryParseHeader(
		c.line + '\n' + c.getLineOrUndefined(1)?.line + '\n' + c.getLineOrUndefined(2)?.line + '\n',
	);
	if (!parsed) {
		throw new SlicerIdentificationNotFound();
	} else {
		if (parsed.processedByRatOSVersion) {
			throw new AlreadyProcessedError(parsed);
		}
		s.gcodeInfo = parsed;
		try {
			switch (parsed.flavour) {
				case GCodeFlavour.Unknown:
					throw new SlicerNotSupported(
						`Slicer '${parsed.generator}' is not supported, and RatOS dialect conformance was not declared.`,
						{ cause: parsed },
					);
				case GCodeFlavour.PrusaSlicer:
					if (semver.neq('2.8.0', parsed.generatorVersion)) {
						throw new SlicerNotSupported(
							`Only version 2.8.0 of PrusaSlicer is supported. Version ${parsed.generatorVersion} is not supported.`,
							{ cause: parsed },
						);
					}
					break;
				case GCodeFlavour.OrcaSlicer:
					if (semver.neq('2.1.1', parsed.generatorVersion)) {
						throw new SlicerNotSupported(
							`Only version 2.1.1 of OrcasSlicer is supported. Version ${parsed.generatorVersion} is not supported.`,
							{ cause: parsed },
						);
					}
					break;
				case GCodeFlavour.SuperSlicer:
					if (!semver.satisfies(parsed.generatorVersion, '2.5.59 || 2.5.60')) {
						throw new SlicerNotSupported(
							`Only versions 2.5.59 and 2.5.60 of SuperSlicer are supported. Version ${parsed.generatorVersion} is not supported.`,
							{ cause: parsed },
						);
					}
					break;
				case GCodeFlavour.RatOS:
					if (semver.neq('0.1', parsed.generatorVersion)) {
						throw new SlicerNotSupported(
							`Only version 0.1 of the RatOS G-code dialect is supported. Version ${parsed.generatorVersion} is not supported.`,
							{ cause: parsed },
						);
					}
					break;
				default:
					throw new InternalError('unexpected state'); // should never happen
			}
		} catch (ex) {
			if (s.kAllowUnsupportedSlicerVersions && s.onWarning && ex instanceof SlicerNotSupported) {
				s.onWarning(
					ACTION_ERROR_CODES.UNSUPPORTED_SLICER_VERSION,
					ex.message + ' This may result in print defects and incorrect operation of the printer.',
				);
			} else {
				throw ex;
			}
		}
	}
	c.line = c.line.padEnd(c.line.length + 100);
	c.bookmarkKey = Symbol('first line');
	s.firstLine = new BookmarkedLine(c.line, c.bookmarkKey);
	return ActionResult.RemoveAndStop;
};

export const getStartPrint: Action = (c, s) => {
	const match =
		/^(START_PRINT|RMMU_START_PRINT)(?=[ $])((?=.*(\sINITIAL_TOOL=(?<INITIAL_TOOL>(\d+))))|)((?=.*(\sEXTRUDER_OTHER_LAYER_TEMP=(?<EXTRUDER_OTHER_LAYER_TEMP>(\d+(,\d+)*))))|)/i.exec(
			c.line,
		);
	if (match) {
		// Fix colour variable format and pad for later modification
		c.line = c.line.replace('#', '').padEnd(c.line.length + 250);
		c.bookmarkKey = Symbol('START_PRINT');
		s.startPrintLine = new BookmarkedLine(c.line, c.bookmarkKey);

		const initialTool = match.groups?.INITIAL_TOOL;
		if (initialTool) {
			s.usedTools.push(initialTool);
		}

		const extruderOtherLayerTemp = match?.groups?.EXTRUDER_OTHER_LAYER_TEMP;
		if (extruderOtherLayerTemp) {
			s.extruderTemps = extruderOtherLayerTemp.split(',');
		}

		return ActionResult.RemoveAndStop;
	}

	if (s.currentLineNumber > 5000) {
		// Most likely the START_PRINT line is missing. If this is a huge file, failing fast will be
		// a better UX.
		// TODO: Make this behaviour configurable, eg add to opts on public API, State holds opts.
		throw new GCodeError(
			'The START_PRINT or RMMU_START_PRINT command has not been found within the first 5000 lines of the file. Please refer to the slicer configuration instructions.',
		);
	}

	// Stop at this point in the action sequence until we find START_LINE. If any actions need to inspect pre-START_LINE,
	// they must be ordered before this action. All actions ordered after this action can assume that
	// the start print line has been found.
	return ActionResult.Stop;
};

export const fixOtherLayerTemperature: Action = [
	GCodeFlavour.OrcaSlicer | GCodeFlavour.SuperSlicer,
	(c, s) => {
		if (!s.onLayerChange2Line) {
			if (/^_ON_LAYER_CHANGE LAYER=2($|[\s;])/i.test(c.line)) {
				c.line = c.line.padEnd(c.line.length + 250);
				c.bookmarkKey = Symbol('on_layer_change 2');
				s.onLayerChange2Line = new BookmarkedLine(c.line, c.bookmarkKey);

				for (let scan of c.scanForward(9)) {
					if (scan.line.startsWith('M104 S')) {
						s.extruderTempLines ??= [];
						scan.line = scan.line.padEnd(scan.line.length + REMOVED_BY_RATOS.length);
						scan.bookmarkKey = Symbol(`extruder temp @ ${scan.offset}`);
						s.extruderTempLines.push(new BookmarkedLine(scan.line, scan.bookmarkKey));
					}
				}

				return ActionResult.RemoveAndStop;
			}
		}
	},
];

export const fixOrcaSetAccelaration: Action = [
	GCodeFlavour.OrcaSlicer,
	(c, s) => {
		// SET_VELOCITY_LIMIT ACCEL=2500 ACCEL_TO_DECEL=1250
		const match = /^SET_VELOCITY_LIMIT.*\sACCEL=(\d+)/i.exec(c.line);
		if (match) {
			c.line = `M204 S${match[1]}${CHANGED_BY_RATOS}${c.line}`;
			return ActionResult.Stop;
		}
	},
];

/**
 * A subsequence entry action that parses `Tn`, `G0` and `G1` commands. All handlers for these commands
 * must be placed in this command's subsequence in the action sequence. If the current line is one
 * of the common commands, the subsequence is executed, then the main sequence stops. If the current
 * line is not one of the common commands, the subsequence is skipped, and the main sequence continues.
 */
export const whenCommonCommandDoThenStop: Action = (c, s) => {
	s._cmd = parseCommonGCodeCommandLine(c.line);
	return s._cmd ? ActionResult.Stop : ActionResult.Continue | ActionResult.flagSkipSubSequence;
};

export const findFirstMoveXY: Action = (c, s) => {
	if (s._cmd!.letter === 'G') {
		s.firstMoveX ??= s._cmd!.x;
		s.firstMoveY ??= s._cmd!.y;

		if (s.firstMoveX && s.firstMoveY) {
			if (s.kQuickInpsectionOnly) {
				throw new InspectionIsComplete();
			}
			// We don't need to do this check any more. G0/G1 are extremely frequent, so avoid any excess work.
			return ActionResult.RemoveAndContinue;
		}
	}
};

export const findMinMaxX: Action = (c, s) => {
	// TODO: Support G2/G3 (arcs)
	if (s._cmd!.letter === 'G') {
		switch (s._cmd!.value) {
			// Reminder: parseCommonGCodeCommandLine normalizes G0 to G1, we only need to check for '1'.
			case '1':
				const x = s._cmd!.x;
				if (x) {
					const n = Number(x);
					if (n < s.minX) {
						s.minX = n;
					}
					if (n > s.maxX) {
						s.maxX = n;
					}
				}
				break;
			case '2':
			case '3':
				throw newGCodeError('G2/G3 commands (arcs) are not currently supported.', c, s);
		}

		// Within the commom commands subgroup, this is the last action that handles to G lines. Subsequent
		// actions will not match, don't bother trying.
		// TODO: Discuss. Optimal, but only a marginal gain in exchange for brittleness of subsequence order.
		return ActionResult.Stop;
	}
};

export const processToolchange: Action = (c, s) => {
	if (s._cmd!.letter === 'T') {
		const tool = s._cmd!.value;
		if (++s.toolChangeCount == 1) {
			// Remove first toolchange
			c.prepend(REMOVED_BY_RATOS);

			// This is the only action that handles `Tn` lines.
			return ActionResult.Stop;
		}

		if (!s.usedTools.includes(tool)) {
			s.usedTools.push(tool);
		}

		// TOOLSHIFT PROCESSING
		// ====================

		// Detect purge/wipe tower:
		if (s.hasPurgeTower === undefined) {
			s.hasPurgeTower = false;
			for (let scan of c.scanBack(19)) {
				if (scan.line.startsWith('; CP TOOLCHANGE START')) {
					s.hasPurgeTower = true;
					break;
				}
			}
		}

		// NOT PORTING `#z-hop before toolchange` (line ~356)
		//  1) it looks like PS and OS no longer zhop around a tool change.
		//  2) SS does still zhop, but will not emit '; custom gcode: end_filament_gcode' by default
		//     and the instructions don't say to set this, so current output from SS will not be
		//     detected anyhow.
		// TODO: Consider reinstating and fixing after initial regression tests pass.
		//
		// UPDATE: Partially porting. Not porting Orca branch as there's no reproduction for that at this time.

		let zHopBeforeToolchange: ProcessLineContext | undefined = undefined;
		if (
			!s.hasPurgeTower &&
			(s.gcodeInfo.flavour === GCodeFlavour.PrusaSlicer || s.gcodeInfo.flavour === GCodeFlavour.SuperSlicer)
		) {
			for (let scan of c.scanBack(19)) {
				if (scan.line.startsWith('; custom gcode: end_filament_gcode')) {
					const preceding = scan.getLine(-1);
					const cmd = parseCommonGCodeCommandLine(preceding.line);
					if (cmd && cmd.letter === 'G' && cmd.value === '1' && cmd.z && !cmd.x && !cmd.y) {
						const z = Number(cmd.z);
						if (z > 0) {
							zHopBeforeToolchange = preceding;
						}
					}
					break;
				}
			}
		}

		// NOT PORTING `# toolchange line` section (line ~379)
		// - This looks for `Tn` from the current line up to 19 lines ahead, but will always match
		//   on the current line because all the code is inside an
		//  `if current line is 'Tn'` check. So `toolchange_line` will always be equal to the current line.

		// Retraction associatd with toolchange (before/after Tn depends on slicer):
		let retractForToolchange: { line: ProcessLineContext; zHopLine?: ProcessLineContext } | undefined = undefined;

		if (!s.hasPurgeTower) {
			switch (s.gcodeInfo.flavour) {
				case GCodeFlavour.PrusaSlicer:
				case GCodeFlavour.SuperSlicer:
					for (let scan of c.scanForward(19)) {
						if (scan.line.startsWith('G1 E-')) {
							retractForToolchange = { line: scan };
							const next = scan.getLine(1);
							if (next.line.startsWith('G1 Z')) {
								retractForToolchange.zHopLine = next;
							}
							break;
						}
					}
					break;
				case GCodeFlavour.OrcaSlicer:
					for (let scan of c.scanBack(19)) {
						if (scan.line.startsWith('G1 E-')) {
							retractForToolchange = { line: scan };
							break;
						}
					}
					break;
			}
		}

		// XY move after toolchange:
		let xyMoveAfterToolchange:
			| { x: string; y: string; line: ProcessLineContext; zHopLine?: ProcessLineContext }
			| undefined = undefined;
		for (let scan of c.scanForward(19)) {
			const match = parseCommonGCodeCommandLine(scan.line);
			if (match) {
				if (match.x && match.y) {
					if (match.e) {
						throw newGCodeError('Unexpected extruding move after toolchange.', scan, s);
					}
					xyMoveAfterToolchange = { x: match.x, y: match.y, line: scan };
					const prev = scan.getLine(-1);
					if (prev.line.startsWith('G1 Z')) {
						xyMoveAfterToolchange.zHopLine = prev;
					}
					break;
				} else if (match.x || match.y) {
					throw newGCodeError('Unexpected X-only or Y-only move after toolchange.', scan, s);
				}
			}
		}

		// NOT PORTING `# z-drop after toolchange` section (line ~379)
		// 1) it looks like PS and OS no longer zhop around a tool change.
		// 2) SS does still zhop, but:
		//    a) the python code fails to detect the hop
		//    b) the python code only looks up to 2 lines ahead for the drop, and this is not far
		//       enough with current SS version output, which has 2 lines of comments after the move line.
		// TODO: Consider reinstating and fixing after initial regression tests pass.

		// Z-move after toolchange. This can be either a z-drop after a z-hop, or it can be just
		// a statement of desired z height, often effectively a no-op.
		let zMoveAfterToolchange: { z: string; line: ProcessLineContext } | undefined = undefined;

		if (!s.hasPurgeTower) {
			switch (s.gcodeInfo.flavour) {
				case GCodeFlavour.PrusaSlicer:
				case GCodeFlavour.SuperSlicer:
				case GCodeFlavour.OrcaSlicer:
					for (let scan of (xyMoveAfterToolchange?.line ?? c).scanForward(2)) {
						const match = parseCommonGCodeCommandLine(scan.line);
						if (match) {
							if (match.z) {
								zMoveAfterToolchange = { z: match.z, line: scan };
								break;
							}
						}
					}
					break;
				// TODO: Porting - Orca branch only applies if there's a z-hop, and z-hop detection is
				// broken in the python code. Reinstate and fix.
			}
		}

		// Deretract after toolchange (`# extrusion after move` in original python)
		let deretractLine: ProcessLineContext | undefined = undefined;

		if (!s.hasPurgeTower && xyMoveAfterToolchange) {
			// TODO: Brittle. Must scan beyond filament start gcode, which is of unknown length. Often at least contains
			// SET_PRESSURE_ADVANCE. Maybe require stricter custom gcode format, eg must end with a line `;END filament gcode`.
			// TODO: BUGGY IN PYTHON, produces incorrect gcode, bug reproduced here for initial regression testing.
			for (let scan of xyMoveAfterToolchange.line.scanForward(4)) {
				if (scan.line.startsWith('G1 E')) {
					const match = parseCommonGCodeCommandLine(scan.line);
					if (match?.e && Number(match.e) > 0) {
						deretractLine = scan;
					}
					break;
				}
			}
		}

		// Convert toolchange to toolshift
		if (xyMoveAfterToolchange) {
			// The aboe condition is ported from python - but why? Should it be an error if there's a toolchange with no xy move found?
			// TODO: reinstate and fix zhop line redaction.
			if (zHopBeforeToolchange) {
				zHopBeforeToolchange.prepend(REMOVED_BY_RATOS);
			}

			if (zMoveAfterToolchange) {
				zMoveAfterToolchange.line.prepend(REMOVED_BY_RATOS);
			}

			c.line = s.kPrinterHasRmmuHub
				? `TOOL T=${tool} X=${xyMoveAfterToolchange.x} Y=${xyMoveAfterToolchange.y}${zMoveAfterToolchange ? ' Z=' + zMoveAfterToolchange.z : ''}`
				: `T${tool} X${xyMoveAfterToolchange.x} Y${xyMoveAfterToolchange.y}${zMoveAfterToolchange ? ' Z' + zMoveAfterToolchange.z : ''}`;

			// --------------------------------------------------------------------------------
			// TG 2024-10-31: Ported from #b1e51390 from RatOS-configuration (HK)
			// temporarily outcommented to fix gcode render issues in gcode viewer applications
			// the toolshift already moves the toolhead to this position but this wont be reflected in viewer applications
			// originally outcommented to avoid microstuttering for ultra fast toolshifts
			// needs to be tested if microstuttering is still an issue
			// --------------------------------------------------------------------------------
			// xyMoveAfterToolchange.line.prepend(REMOVED_BY_RATOS);
			// --------------------------------------------------------------------------------

			if (
				xyMoveAfterToolchange.zHopLine &&
				!retractForToolchange?.zHopLine && // avoid double-prepending the same line
				(s.gcodeInfo.flavour === GCodeFlavour.PrusaSlicer || s.gcodeInfo.flavour === GCodeFlavour.SuperSlicer)
			) {
				xyMoveAfterToolchange.zHopLine.prepend(REMOVED_BY_RATOS);
			}

			if (retractForToolchange && deretractLine) {
				retractForToolchange.line.prepend(REMOVED_BY_RATOS);
				retractForToolchange.zHopLine?.prepend(REMOVED_BY_RATOS);
				deretractLine.prepend(REMOVED_BY_RATOS);
			}
		}

		// This is the only action that handles `Tn` lines.
		return ActionResult.Stop;
	}
};

export const captureConfigSection: Action = (c, s) => {
	let startLine: string | undefined = undefined;
	let endLine: string | undefined = undefined;
	switch (s.gcodeInfo.flavour) {
		case GCodeFlavour.PrusaSlicer:
			startLine = '; prusaslicer_config = begin';
			endLine = '; prusaslicer_config = end';
			break;
		case GCodeFlavour.OrcaSlicer:
			startLine = '; CONFIG_BLOCK_START';
			endLine = '; CONFIG_BLOCK_END';
			break;
		case GCodeFlavour.SuperSlicer:
			startLine = '; SuperSlicer_config = begin';
			endLine = '; SuperSlicer_config = end';
			break;
		default:
			// Config section not supported
			return ActionResult.RemoveAndContinue;
	}

	// Replace this action with the action to look for the flavour-specific start line:
	return [
		ActionResult.Continue,
		(c, s) => {
			if (c.line.startsWith(startLine)) {
				s.configSection = new Map<string, string>();
				// Replace this action with the action to capture the config section:
				return [
					ActionResult.Stop,
					(c, s) => {
						if (c.line.startsWith(endLine)) {
							return ActionResult.RemoveAndStop;
						} else {
							const match = /^; ([^\s]+)\s=\s(.+)/.exec(c.line);
							if (match) {
								s.configSection!.set(match[1], match[2]);
							}
						}
					},
				];
			}
		},
	];
};
