import {
	FilamentSensor,
	HARDWARE_REGISTRY,
	HardwareInstanceType,
	UnconnectedHardwareInstanceType,
} from '@/zods/hardware';
import type { PartialPrinterConfiguration } from '@/zods/printer-configuration';
import { parseJsonMetaDirectory } from '@/server/routers/printer';
import { getJsonMetaDirectoryName, parseBoardPinConfig } from '@/server/helpers/metadata';
import { PartialToolheadConfiguration } from '@/zods/toolhead';
import { TemplateModule } from '@/templates/template-api';
import { HardwareInstance } from '@/zods/template-api';

/**
 * Return valid filament sensor options considering the controlboard and/or toolhead configuration.
 *
 * @param config A partial printer configuration or null. Only a subset is used:
 *               - `controlboard` — the selected control board (used to resolve pins)
 *               - `toolheads` — an array of toolheads (used when toolNumber is supplied)
 *
 * @param toolNumber Optional toolhead index to select the toolhead from the printer config.
 *                   If not provided, toolheadConfig must be provided.
 *
 * @param toolheadConfig Optional partial toolhead configuration to use directly. Only a subset is used:
 * 					- `toolboard` — the selected toolboard (used to resolve pins)
 * 					- `toolNumber` — the tool number (used for badge purposes), can also be provided via toolNumber param.
 *					Note:
 *                    You must provide either toolNumber or toolheadConfig to identify the toolhead.
 *                    You must also provide { controlboard } in config if you want to consider controlboard pins.
 *
 * Typical callers:
 *  - Pass a printer config and tool number; or
 *  - Pass a printer config and toolheadConfig; or
 *  - Pass a minimal { controlboard } config and toolheadConfig.
 */
export async function getCompatibleHardwareInstances<K extends keyof typeof HARDWARE_REGISTRY>(
	type: K,
	config?: PartialPrinterConfiguration | null,
	toolNumber?: number | null,
	toolheadConfig?: PartialToolheadConfiguration | null,
): Promise<HardwareInstanceType<K>[]> {
	if (toolNumber != null && toolheadConfig?.toolNumber != null && toolheadConfig.toolNumber !== toolNumber) {
		throw new Error('toolNumber and toolheadConfig.toolNumber do not match.');
	}
	toolNumber ??= toolheadConfig?.toolNumber;
	if (
		toolheadConfig == null &&
		toolNumber != null &&
		config?.toolheads != null &&
		config.toolheads.length > toolNumber
	) {
		toolheadConfig = config.toolheads[toolNumber];
	}
	const toolboard = toolheadConfig?.toolboard;
	const controlboard = config?.controlboard;
	const hasToolboard = toolboard != null;
	const hasControlboard = controlboard != null;

	if (!hasToolboard && !hasControlboard) {
		return [];
	}

	const toolboardPins = hasToolboard ? await parseBoardPinConfig(toolboard) : null;

	// TODO: For now, don't allow T1 components to connect to the controlboard. This is a big hammer to stop
	// users using the same controlboard pins for two sensors, one associated with each toolhead. There are
	// valid use cases: for example, IDEX with two chassis-mounted filament sensors both connected to the controlboard.
	// However, right now we don't have the logic to support this safely, so we block it for now. A user could
	// of course add custom config for the T1 control-board connected hardware.
	const controlboardPins = toolNumber === 0 && hasControlboard ? await parseBoardPinConfig(controlboard!) : null;

	const directoryName = getJsonMetaDirectoryName(type);
	const allUnconnectedInstances: UnconnectedHardwareInstanceType<K>[] = await parseJsonMetaDirectory(directoryName);
	const compatibleConnectedInstances: HardwareInstanceType<K>[] = [];

	for (const item of allUnconnectedInstances) {
		// NOTE: The import argument must be a template literal for webpack to parse it correctly
		/* webpackInclude: /\.ts$/ */
		const templateModule = TemplateModule.parse(await import(`../templates/${directoryName}/${item.template}`));
		const requiredPins = templateModule.getRequiredPinAliases({ templateOptions: item.templateOptions ?? {} });

		if (controlboardPins && requiredPins.every((pin) => controlboardPins[pin] != null)) {
			const instance = {
				...item,
				connectedTo: 'controlboard',
				badge: [
					{
						color: 'purple',
						children: controlboard!.name,
					},
				],
			} satisfies HardwareInstance;
			compatibleConnectedInstances.push(instance);
		}

		if (toolboardPins && requiredPins.every((pin) => toolboardPins[pin] != null)) {
			const instance = {
				...item,
				connectedTo: 'toolboard',
				badge: [
					{
						color: 'sky',
						children: `${toolboard!.name} T${toolNumber}`,
					},
				],
			} satisfies HardwareInstance;
			compatibleConnectedInstances.push(instance);
		}
	}

	return compatibleConnectedInstances;
}

/**
 * Return valid filament sensor options considering the controlboard and/or toolhead configuration.
 *
 * @param config A partial printer configuration or null. Only a subset is used:
 *               - `controlboard` — the selected control board (used to resolve pins)
 *               - `toolheads` — an array of toolheads (used when toolNumber is supplied)
 *
 * @param toolNumber Optional toolhead index to select the toolhead from the printer config.
 *                   If not provided, toolheadConfig must be provided.
 *
 * @param toolheadConfig Optional partial toolhead configuration to use directly. Only a subset is used:
 * 					- `toolboard` — the selected toolboard (used to resolve pins)
 * 					- `toolNumber` — the tool number (used for badge purposes), can also be provided via toolNumber param.
 *					Note:
 *                    You must provide either toolNumber or toolheadConfig to identify the toolhead.
 *                    You must also provide { controlboard } in config if you want to consider controlboard pins.
 *
 * Typical callers:
 *  - Pass a printer config and tool number; or
 *  - Pass a printer config and toolheadConfig; or
 *  - Pass a minimal { controlboard } config and toolheadConfig.
 */
export async function filamentSensorOptions(
	config?: PartialPrinterConfiguration | null,
	toolNumber?: number | null,
	toolheadConfig?: PartialToolheadConfiguration | null,
): Promise<FilamentSensor[]> {
	return getCompatibleHardwareInstances('filament-sensor', config, toolNumber, toolheadConfig);
}
