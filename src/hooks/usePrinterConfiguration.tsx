'use client';

import { atom, selector, useRecoilValue, useRecoilState, waitForAll, noWait, DefaultValue } from 'recoil';
import { z } from 'zod';
import {
	Fan,
	ChamberAirFilter,
	OptionalChamberAirFilterRef,
	ChamberLighting,
	OptionalChamberLightingRef,
	ToolheadAlignmentSystem,
	OptionalToolheadAlignmentSystemRef,
	ChamberLightingSchemas,
	ToolheadAlignmentSystemSchemas,
	ChamberAirFilterSchemas,
	ChamberLightingRef,
	ToolheadAlignmentSystemRef,
	ChamberAirFilterRef,
} from '@/zods/hardware';
import {
	PartialPrinterConfiguration,
	PrinterConfiguration,
	SerializedPartialPrinterConfiguration,
	SerializedPrinterConfiguration,
} from '@/zods/printer-configuration';
import { syncEffect } from 'recoil-sync';
import { getRefineCheckerForZodSchema } from 'zod-refine';
import { useMemo } from 'react';
import {
	serializePartialToolheadConfiguration,
	serializePrinterRail,
	serializeToolheadConfiguration,
} from '@/utils/serialization';
import { ControlboardState, PrinterRailsState, PrinterSizeState, PrinterState } from '@/recoil/printer';
import { PrinterToolheadsState } from '@/recoil/toolhead';
import { defaultControllerFan } from '@/data/fans';
import { moonrakerWriteEffect } from '@/components/sync-with-moonraker';
import { getLogger } from '@/app/_helpers/logger';
import { trpcClient } from '@/helpers/trpc';
import {
	CompatibleChamberAirFilterQuery,
	CompatibleChamberLightingQuery,
	CompatibleToolheadAlignmentSystemQuery,
} from '@/recoil/hardware-options';

/* Message to future devs who are not gurus in this code area:
 *
 * Inside atom<...> effects, note that the 'key' used in read() and write() calls
 * must match the key of the atom or selector being accessed. The moonrakerWriteEffect()
 * will *always* use the defined key of the atom/selector it's attached to, not whatever
 * is passed to write(). Even though techincally you don't need to use the same key for
 * both the recoil and moonraker keys, the automatic behaviour of moonrakerWriteEffect() makes
 * this effectively mandatory.
 */

const enum AtomKeys {
	ChamberLightingRef = 'ChamberLightingRef',
	ChamberAirFilterRef = 'ChamberAirFilterRef',
	ToolheadAlignmentSystemRef = 'ToolheadAlignmentSystemRef',
}

export const PerformanceModeState = atom<boolean | null | undefined>({
	key: 'PerformanceMode',
	default: false,
	effects: [
		moonrakerWriteEffect(),
		syncEffect({
			refine: getRefineCheckerForZodSchema(z.boolean().optional().nullable()),
		}),
	],
});

//-----------------------------------------------------------------------------
// Chamber Lighting
//-----------------------------------------------------------------------------

export const ChamberLightingRefState = atom<OptionalChamberLightingRef>({
	key: AtomKeys.ChamberLightingRef,
	default: undefined,
	effects: [
		moonrakerWriteEffect(),
		syncEffect({
			write: ({ write }, newValue) => {
				if (newValue instanceof DefaultValue || newValue == null) {
					write(AtomKeys.ChamberLightingRef, DefaultValue);
				} else {
					const parsed = ChamberLightingRef.safeParse(newValue);
					if (parsed.success) {
						write(AtomKeys.ChamberLightingRef, parsed.data);
					} else {
						getLogger().error(
							'RecoilSync: tried to write an invalid ChamberLightingRef, will set to default.',
							parsed.error,
							newValue,
						);
						write(AtomKeys.ChamberLightingRef, DefaultValue);
					}
				}
			},
			refine: getRefineCheckerForZodSchema(OptionalChamberLightingRef),
		}),
	],
});

export const ChamberLightingState = selector<ChamberLighting | undefined>({
	key: 'ChamberLighting',
	get: async ({ get }) => {
		const chamberLightingRef = get(ChamberLightingRefState);
		if (chamberLightingRef == null) {
			return undefined;
		}
		return get(CompatibleChamberLightingQuery).find((opt) => ChamberLightingSchemas.refEquals(opt, chamberLightingRef));
	},
	set: ({ set }, newValue) => {
		if (newValue instanceof DefaultValue || newValue == null) {
			set(ChamberLightingRefState, undefined);
		} else {
			set(ChamberLightingRefState, ChamberLightingSchemas.toRef(newValue));
		}
	},
});

//-----------------------------------------------------------------------------
// Toolhead Alignment System
//-----------------------------------------------------------------------------

export const ToolheadAlignmentSystemRefState = atom<OptionalToolheadAlignmentSystemRef>({
	key: AtomKeys.ToolheadAlignmentSystemRef,
	default: undefined,
	effects: [
		moonrakerWriteEffect(),
		syncEffect({
			write: ({ write }, newValue) => {
				if (newValue instanceof DefaultValue || newValue == null) {
					write(AtomKeys.ToolheadAlignmentSystemRef, DefaultValue);
				} else {
					const parsed = ToolheadAlignmentSystemRef.safeParse(newValue);
					if (parsed.success) {
						write(AtomKeys.ToolheadAlignmentSystemRef, parsed.data);
					} else {
						getLogger().error(
							'RecoilSync: tried to write an invalid ToolheadAlignmentSystemRef, will set to default.',
							parsed.error,
							newValue,
						);
						write(AtomKeys.ToolheadAlignmentSystemRef, DefaultValue);
					}
				}
			},
			refine: getRefineCheckerForZodSchema(OptionalToolheadAlignmentSystemRef),
		}),
	],
});

export const ToolheadAlignmentSystemState = selector<ToolheadAlignmentSystem | undefined>({
	key: 'ToolheadAlignmentSystem',
	get: async ({ get }) => {
		const ToolheadAlignmentSystemRef = get(ToolheadAlignmentSystemRefState);
		if (ToolheadAlignmentSystemRef == null) {
			return undefined;
		}
		return get(CompatibleToolheadAlignmentSystemQuery).find((opt) =>
			ToolheadAlignmentSystemSchemas.refEquals(opt, ToolheadAlignmentSystemRef),
		);
	},
	set: ({ set }, newValue) => {
		if (newValue instanceof DefaultValue || newValue == null) {
			set(ToolheadAlignmentSystemRefState, undefined);
		} else {
			set(ToolheadAlignmentSystemRefState, ToolheadAlignmentSystemSchemas.toRef(newValue));
		}
	},
});

//-----------------------------------------------------------------------------
// Chamber Air Filter
//-----------------------------------------------------------------------------

export const ChamberAirFilterRefState = atom<OptionalChamberAirFilterRef>({
	key: AtomKeys.ChamberAirFilterRef,
	default: undefined,
	effects: [
		moonrakerWriteEffect(),
		syncEffect({
			write: ({ write }, newValue) => {
				if (newValue instanceof DefaultValue || newValue == null) {
					write(AtomKeys.ChamberAirFilterRef, DefaultValue);
				} else {
					const parsed = ChamberAirFilterRef.safeParse(newValue);
					if (parsed.success) {
						write(AtomKeys.ChamberAirFilterRef, parsed.data);
					} else {
						getLogger().error(
							'RecoilSync: tried to write an invalid ChamberAirFilterRef, will set to default.',
							parsed.error,
							newValue,
						);
						write(AtomKeys.ChamberAirFilterRef, DefaultValue);
					}
				}
			},
			refine: getRefineCheckerForZodSchema(OptionalChamberAirFilterRef),
		}),
	],
});

export const ChamberAirFilterState = selector<ChamberAirFilter | undefined>({
	key: 'ChamberAirFilter',
	get: async ({ get }) => {
		const ChamberAirFilterRef = get(ChamberAirFilterRefState);
		if (ChamberAirFilterRef == null) {
			return undefined;
		}
		return get(CompatibleChamberAirFilterQuery).find((opt) =>
			ChamberAirFilterSchemas.refEquals(opt, ChamberAirFilterRef),
		);
	},
	set: ({ set }, newValue) => {
		if (newValue instanceof DefaultValue || newValue == null) {
			set(ChamberAirFilterRefState, undefined);
		} else {
			set(ChamberAirFilterRefState, ChamberAirFilterSchemas.toRef(newValue));
		}
	},
});

export const StealthchopState = atom<boolean | null | undefined>({
	key: 'Stealchop',
	default: false,
	effects: [
		moonrakerWriteEffect(),
		syncEffect({
			refine: getRefineCheckerForZodSchema(z.boolean().optional().nullable()),
		}),
	],
});

export const StandstillStealthState = atom<boolean | null | undefined>({
	key: 'StandstillStealth',
	default: false,
	effects: [
		moonrakerWriteEffect(),
		syncEffect({
			refine: getRefineCheckerForZodSchema(z.boolean().optional().nullable()),
		}),
	],
});
export const ControllerFanState = atom<z.infer<typeof Fan> | null>({
	key: 'ControllerFan',
	default: defaultControllerFan,
	effects: [
		moonrakerWriteEffect(),
		syncEffect({
			read: async ({ read }) => {
				const fanState = await read(ControllerFanState.key);
				if (fanState != null) {
					// If it's already a full object, return it
					const parsedFan = Fan.safeParse(fanState);
					if (parsedFan.success) {
						return parsedFan.data;
					}
					// If it's just an ID string, deserialize it via the server
					if (typeof fanState === 'string') {
						try {
							const controlboardState = await read('Controlboard');
							const controlboardId =
								typeof controlboardState === 'object' && controlboardState != null && 'id' in controlboardState
									? (controlboardState as any).id
									: null;
							const fanOptions = await trpcClient.printer.controllerFanOptions.query({
								config: { controlboard: controlboardId },
							});
							const fan = fanOptions.find((f) => f.id === fanState);
							if (fan != null) {
								return fan;
							}
						} catch (error) {
							getLogger().error('RecoilSync: failed to deserialize controller fan!', error, fanState);
						}
					}
				}
				return defaultControllerFan;
			},
			write: ({ write }, newValue) => {
				// Serialize the fan to store only the ID
				if (newValue instanceof DefaultValue || newValue == null) {
					write(ControllerFanState.key, newValue);
					return;
				}
				write(ControllerFanState.key, newValue.id);
			},
			refine: getRefineCheckerForZodSchema(Fan.nullable()),
		}),
	],
});

export const PrinterConfigurationState = selector<z.infer<typeof PartialPrinterConfiguration> | null>({
	key: 'PrinterConfiguration',
	get: async ({ get }) => {
		const {
			printer,
			printerSize,
			performanceMode,
			stealthchop,
			standstillStealth,
			chamberLighting,
			toolheadAlignmentSystem,
			chamberAirFilter,
			rails,
			controlboard,
			controllerFan,
			toolheads,
		} = get(
			waitForAll({
				printer: PrinterState,
				printerSize: PrinterSizeState,
				performanceMode: PerformanceModeState,
				stealthchop: StealthchopState,
				standstillStealth: StandstillStealthState,
				chamberLighting: ChamberLightingState,
				toolheadAlignmentSystem: ToolheadAlignmentSystemState,
				chamberAirFilter: ChamberAirFilterState,
				rails: PrinterRailsState,
				controlboard: ControlboardState,
				controllerFan: ControllerFanState,
				toolheads: PrinterToolheadsState,
			}),
		);

		const input = {
			printer:
				printer == null
					? null
					: {
							...printer,
							defaults: {
								...printer.defaults,
								toolheads: printer?.defaults.toolheads.map((th) => serializeToolheadConfiguration(th)),
							},
						},
			size: printerSize,
			performanceMode,
			stealthchop,
			standstillStealth,
			chamberLighting,
			toolheadAlignmentSystem,
			chamberAirFilter,
			rails,
			controlboard,
			controllerFan,
			toolheads: toolheads.length > 0 ? toolheads : undefined,
		} satisfies {
			[key in keyof PrinterConfiguration]: NonNullable<PartialPrinterConfiguration>[key] | null | undefined;
		};

		const printerConfig = PartialPrinterConfiguration.safeParse(input);
		if (printerConfig.success === false) {
			getLogger().error(
				{ errors: printerConfig.error.flatten().fieldErrors, data: input },
				"Couldn't parse printer configuration",
			);
		}
		return printerConfig.success ? printerConfig.data : null;
	},
});

export const LoadablePrinterConfigurationState = selector<z.infer<typeof PartialPrinterConfiguration>>({
	key: 'LoadablePrinterConfigurationState',
	get: async ({ get }) => {
		const loadable = get(noWait(PrinterConfigurationState));
		return {
			hasValue: () => loadable.contents,
			hasError: () => null,
			loading: () => null,
		}[loadable.state]();
	},
});

export const serializePrinterConfiguration = (config: PrinterConfiguration): SerializedPrinterConfiguration => {
	const serializedConfig: SerializedPrinterConfiguration = {
		printer: config.printer.id,
		toolheads: config.toolheads.map((toolhead) => serializeToolheadConfiguration(toolhead)),
		size: config.size,
		controlboard: config.controlboard.id,
		controllerFan: config.controllerFan.id,
		performanceMode: config.performanceMode,
		stealthchop: config.stealthchop,
		standstillStealth: config.standstillStealth,
		chamberLighting: ChamberLightingSchemas.toOptionalRef(config.chamberLighting),
		toolheadAlignmentSystem: ToolheadAlignmentSystemSchemas.toOptionalRef(config.toolheadAlignmentSystem),
		chamberAirFilter: ChamberAirFilterSchemas.toOptionalRef(config.chamberAirFilter),
		rails: config.rails.map((rail) => serializePrinterRail(rail)),
	};
	return SerializedPrinterConfiguration.parse(serializedConfig);
};
export const serializePartialPrinterConfiguration = (
	config: PartialPrinterConfiguration,
): SerializedPartialPrinterConfiguration => {
	const toolheads = config?.toolheads?.map((toolhead) => serializePartialToolheadConfiguration(toolhead));
	const serializedConfig: SerializedPartialPrinterConfiguration = {
		printer: config?.printer?.id,
		toolheads: toolheads,
		size: config?.size,
		controlboard: config?.controlboard?.id,
		controllerFan: config?.controllerFan?.id,
		performanceMode: config?.performanceMode,
		stealthchop: config?.stealthchop,
		standstillStealth: config?.standstillStealth,
		chamberLighting: ChamberLightingSchemas.toOptionalRef(config?.chamberLighting),
		toolheadAlignmentSystem: ToolheadAlignmentSystemSchemas.toOptionalRef(config?.toolheadAlignmentSystem),
		chamberAirFilter: ChamberAirFilterSchemas.toOptionalRef(config?.chamberAirFilter),
	};
	return SerializedPartialPrinterConfiguration.parse(serializedConfig);
};

export const useSerializedPrinterConfiguration = () => {
	const printerConfiguration = useRecoilValue(PrinterConfigurationState);
	const serializedPrinterConfiguration = useMemo(
		() => serializePartialPrinterConfiguration(printerConfiguration ?? {}),
		[printerConfiguration],
	);
	return serializedPrinterConfiguration;
};
export const usePrinterConfiguration = () => {
	const [selectedPrinter, setSelectedPrinter] = useRecoilState(PrinterState);
	const [selectedPrinterOption, setSelectedPrinterOption] = useRecoilState(PrinterSizeState);
	const [selectedBoard, setSelectedBoard] = useRecoilState(ControlboardState);
	const [performanceMode, setPerformanceMode] = useRecoilState(PerformanceModeState);
	const [stealthchop, setStealthchop] = useRecoilState(StealthchopState);
	const [standstillStealth, setStandstillStealth] = useRecoilState(StandstillStealthState);
	const [chamberLighting, setChamberLighting] = useRecoilState(ChamberLightingState);
	const [toolheadAlignmentSystem, setToolheadAlignmentSystem] = useRecoilState(ToolheadAlignmentSystemState);
	const [chamberAirFilter, setChamberAirFilter] = useRecoilState(ChamberAirFilterState);
	const [selectedControllerFan, setSelectedControllerFan] = useRecoilState(ControllerFanState);
	const selectedPrinterRails = useRecoilValue(PrinterRailsState);
	const printerConfiguration = useRecoilValue(PrinterConfigurationState);
	const serializedPrinterConfiguration = useSerializedPrinterConfiguration();
	const parsedPrinterConfiguration = PrinterConfiguration.safeParse(printerConfiguration);

	return {
		selectedPrinter,
		setSelectedPrinter,
		selectedPrinterOption,
		setSelectedPrinterOption,
		selectedBoard,
		setSelectedBoard,
		performanceMode,
		setPerformanceMode,
		stealthchop,
		setStealthchop,
		standstillStealth,
		setStandstillStealth,
		chamberLighting,
		setChamberLighting,
		toolheadAlignmentSystem,
		setToolheadAlignmentSystem,
		chamberAirFilter,
		setChamberAirFilter,
		selectedPrinterRails,
		selectedControllerFan,
		setSelectedControllerFan,
		partialPrinterConfiguration: printerConfiguration,
		serializedPrinterConfiguration,
		parsedPrinterConfiguration,
	};
};
