/**
 * Hardware Options Selectors
 *
 * This file contains Recoil selectors for all hardware option queries.
 * These selectors replace the imperative DropdownWithPrinterQuery pattern
 * with declarative, reactive state management.
 *
 * Benefits:
 * - Automatic recomputation when dependencies change
 * - Proper caching via Recoil
 * - Type-safe throughout
 * - Centralized error handling
 * - Easy to test
 */

import { selector, selectorFamily } from 'recoil';
import { trpcClient } from '@/helpers/trpc';
import { getLogger } from '@/app/_helpers/logger';
import { ControlboardState } from '@/recoil/printer';
import { PrinterToolheadState } from '@/recoil/toolhead';
import { ToolOrAxis, ToolNumber } from '@/zods/toolhead';
import { PrinterAxis } from '@/zods/motion';
import {
	Hotend,
	Extruder,
	Probe,
	Endstop,
	Fan,
	Accelerometer,
	FilamentSensor,
	ChamberLighting,
	ToolheadAlignmentSystem,
	ChamberAirFilter,
} from '@/zods/hardware';
import { serializePartialToolheadConfiguration } from '@/utils/serialization';

//-----------------------------------------------------------------------------
// Helper Functions
//-----------------------------------------------------------------------------

/**
 * Extracts tool number from ToolOrAxis parameter
 */
export const extractToolNumber = (toolOrAxis: ToolOrAxis): ToolNumber => {
	if (typeof toolOrAxis === 'number') {
		return toolOrAxis as ToolNumber;
	}
	// Map axis to tool number
	if (toolOrAxis === PrinterAxis.x || toolOrAxis === PrinterAxis.extruder) {
		return 0;
	}
	if (toolOrAxis === PrinterAxis.dual_carriage || toolOrAxis === PrinterAxis.extruder1) {
		return 1;
	}
	// Default to tool 0
	return 0;
};

//-----------------------------------------------------------------------------
// Non-Toolhead-Specific Hardware Selectors
//-----------------------------------------------------------------------------

/**
 * Query all available hotends from the server
 */
export const HotendsQuery = selector<Hotend[]>({
	key: 'HotendsQuery',
	get: async () => {
		try {
			return await trpcClient.printer.hotends.query();
		} catch (error) {
			getLogger().error('Failed to fetch hotends', error);
			return [];
		}
	},
});

/**
 * Query all available extruders from the server
 */
export const ExtrudersQuery = selector<Extruder[]>({
	key: 'ExtrudersQuery',
	get: async () => {
		try {
			return await trpcClient.printer.extruders.query();
		} catch (error) {
			getLogger().error('Failed to fetch extruders', error);
			return [];
		}
	},
});

/**
 * Query all available probes from the server
 */
export const ProbesQuery = selector<Probe[]>({
	key: 'ProbesQuery',
	get: async () => {
		try {
			return await trpcClient.printer.probes.query();
		} catch (error) {
			getLogger().error('Failed to fetch probes', error);
			return [];
		}
	},
});

/**
 * Query all available thermistors from the server
 */
export const ThermistorsQuery = selector<Array<{ id: string; title: string }>>({
	key: 'ThermistorsQuery',
	get: async () => {
		try {
			return await trpcClient.printer.thermistors.query();
		} catch (error) {
			getLogger().error('Failed to fetch thermistors', error);
			return [];
		}
	},
});

//-----------------------------------------------------------------------------
// Toolhead-Specific Hardware Selectors
//-----------------------------------------------------------------------------

/**
 * Query compatible X endstops for a specific toolhead
 * Depends on: controlboard, toolhead configuration
 */
export const CompatibleXEndstopsQuery = selectorFamily<Endstop[], ToolOrAxis>({
	key: 'CompatibleXEndstopsQuery',
	get:
		(toolOrAxis) =>
		async ({ get }) => {
			const controlboard = get(ControlboardState);
			const toolNumber = extractToolNumber(toolOrAxis);
			const toolhead = get(PrinterToolheadState(toolNumber));

			if (!controlboard) {
				return [];
			}

			try {
				return await trpcClient.printer.xEndstops.query({
					config: controlboard ? { controlboard: controlboard.id } : null,
					toolOrAxis,
				});
			} catch (error) {
				getLogger().error('Failed to fetch X endstops', error);
				return [];
			}
		},
});

/**
 * Query compatible Y endstops for a specific toolhead
 * Depends on: controlboard, toolhead configuration
 */
export const CompatibleYEndstopsQuery = selectorFamily<Endstop[], ToolOrAxis>({
	key: 'CompatibleYEndstopsQuery',
	get:
		(toolOrAxis) =>
		async ({ get }) => {
			const controlboard = get(ControlboardState);
			const toolNumber = extractToolNumber(toolOrAxis);
			const toolhead = get(PrinterToolheadState(toolNumber));

			if (!controlboard) {
				return [];
			}

			try {
				return await trpcClient.printer.yEndstops.query({
					config: controlboard ? { controlboard: controlboard.id } : null,
					toolOrAxis,
				});
			} catch (error) {
				getLogger().error('Failed to fetch Y endstops', error);
				return [];
			}
		},
});

/**
 * Query compatible part cooling fans for a specific toolhead
 * Depends on: controlboard, toolhead configuration
 */
export const CompatiblePartFansQuery = selectorFamily<Fan[], ToolOrAxis>({
	key: 'CompatiblePartFansQuery',
	get:
		(toolOrAxis) =>
		async ({ get }) => {
			const controlboard = get(ControlboardState);
			const toolNumber = extractToolNumber(toolOrAxis);
			const toolhead = get(PrinterToolheadState(toolNumber));

			if (!controlboard) {
				return [];
			}

			try {
				return await trpcClient.printer.partFanOptions.query({
					config: controlboard ? { controlboard: controlboard.id } : null,
					toolOrAxis,
				});
			} catch (error) {
				getLogger().error('Failed to fetch part fan options', error);
				return [];
			}
		},
});

/**
 * Query compatible hotend fans for a specific toolhead
 * Depends on: controlboard, toolhead configuration
 */
export const CompatibleHotendFansQuery = selectorFamily<Fan[], ToolOrAxis>({
	key: 'CompatibleHotendFansQuery',
	get:
		(toolOrAxis) =>
		async ({ get }) => {
			const controlboard = get(ControlboardState);
			const toolNumber = extractToolNumber(toolOrAxis);
			const toolhead = get(PrinterToolheadState(toolNumber));

			if (!controlboard) {
				return [];
			}

			try {
				return await trpcClient.printer.hotendFanOptions.query({
					config: controlboard ? { controlboard: controlboard.id } : null,
					toolOrAxis,
				});
			} catch (error) {
				getLogger().error('Failed to fetch hotend fan options', error);
				return [];
			}
		},
});

/**
 * Query compatible X accelerometers for a specific toolhead
 * Depends on: controlboard, toolhead configuration
 */
export const CompatibleXAccelerometersQuery = selectorFamily<Accelerometer[], ToolOrAxis>({
	key: 'CompatibleXAccelerometersQuery',
	get:
		(toolOrAxis) =>
		async ({ get }) => {
			const controlboard = get(ControlboardState);
			const toolNumber = extractToolNumber(toolOrAxis);
			const toolhead = get(PrinterToolheadState(toolNumber));

			if (!controlboard) {
				return [];
			}

			try {
				return await trpcClient.printer.xAccelerometerOptions.query({
					config: controlboard ? { controlboard: controlboard.id } : null,
					toolOrAxis,
				});
			} catch (error) {
				getLogger().error('Failed to fetch X accelerometer options', error);
				return [];
			}
		},
});

/**
 * Query compatible Y accelerometers for a specific toolhead
 * Depends on: controlboard, toolhead configuration
 */
export const CompatibleYAccelerometersQuery = selectorFamily<Accelerometer[], ToolOrAxis>({
	key: 'CompatibleYAccelerometersQuery',
	get:
		(toolOrAxis) =>
		async ({ get }) => {
			const controlboard = get(ControlboardState);
			const toolNumber = extractToolNumber(toolOrAxis);
			const toolhead = get(PrinterToolheadState(toolNumber));

			if (!controlboard) {
				return [];
			}

			try {
				return await trpcClient.printer.yAccelerometerOptions.query({
					config: controlboard ? { controlboard: controlboard.id } : null,
					toolOrAxis,
				});
			} catch (error) {
				getLogger().error('Failed to fetch Y accelerometer options', error);
				return [];
			}
		},
});

/**
 * Query compatible filament sensors for a specific toolhead
 * Depends on: controlboard, toolhead configuration
 */
export const CompatibleFilamentSensorsQuery = selectorFamily<FilamentSensor[], ToolOrAxis>({
	key: 'CompatibleFilamentSensorsQuery',
	get:
		(toolOrAxis) =>
		async ({ get }) => {
			const controlboard = get(ControlboardState);
			const toolNumber = extractToolNumber(toolOrAxis);
			const toolhead = get(PrinterToolheadState(toolNumber));

			if (!controlboard || !toolhead) {
				return [];
			}

			try {
				return await trpcClient.printer.filamentSensorOptions.query({
					config: controlboard ? { controlboard: controlboard.id } : null,
					toolheadConfig: serializePartialToolheadConfiguration(toolhead),
					toolOrAxis,
				});
			} catch (error) {
				getLogger().error('Failed to fetch filament sensor options', error);
				return [];
			}
		},
});

/**
 * Query compatible controller fans
 * Depends on: controlboard configuration
 * Note: This is not toolhead-specific but depends on the overall printer config
 */
export const CompatibleControllerFansQuery = selector<Fan[]>({
	key: 'CompatibleControllerFansQuery',
	get: async ({ get }) => {
		const controlboard = get(ControlboardState);

		if (!controlboard) {
			return [];
		}

		try {
			return await trpcClient.printer.controllerFanOptions.query({
				config: { controlboard: controlboard.id },
			});
		} catch (error) {
			getLogger().error('Failed to fetch controller fan options', error);
			return [];
		}
	},
});

/**
 * Query compatible chamber lighting options
 * Depends on: controlboard configuration
 */
export const CompatibleChamberLightingQuery = selector<ChamberLighting[]>({
	key: 'CompatibleChamberLightingQuery',
	get: async ({ get }) => {
		const controlboard = get(ControlboardState);

		if (!controlboard) {
			return [];
		}

		try {
			return await trpcClient.printer.chamberLightingOptions.query({
				config: { controlboard: controlboard.id },
			});
		} catch (error) {
			getLogger().error('Failed to fetch chamber lighting options', error);
			return [];
		}
	},
});

/**
 * Query compatible toolhead alignment system options
 * Depends on: controlboard configuration
 */
export const CompatibleToolheadAlignmentSystemQuery = selector<ToolheadAlignmentSystem[]>({
	key: 'CompatibleToolheadAlignmentSystemQuery',
	get: async ({ get }) => {
		const controlboard = get(ControlboardState);

		if (!controlboard) {
			return [];
		}

		try {
			return await trpcClient.printer.toolheadAlignmentSystemOptions.query({
				config: { controlboard: controlboard.id },
			});
		} catch (error) {
			getLogger().error('Failed to fetch toolhead alignment system options', error);
			return [];
		}
	},
});

/**
 * Query compatible chamber air filter options
 * Depends on: controlboard configuration
 */
export const CompatibleChamberAirFilterQuery = selector<ChamberAirFilter[]>({
	key: 'CompatibleChamberAirFilterQuery',
	get: async ({ get }) => {
		const controlboard = get(ControlboardState);

		if (!controlboard) {
			return [];
		}

		try {
			return await trpcClient.printer.chamberAirFilterOptions.query({
				config: { controlboard: controlboard.id },
			});
		} catch (error) {
			getLogger().error('Failed to fetch chamber air filter options', error);
			return [];
		}
	},
});
