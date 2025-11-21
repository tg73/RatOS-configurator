import { z } from 'zod';
import { ChamberAirFilter, ChamberLighting, ToolheadAlignmentSystem } from '@/zods/hardware';
import type { PartialPrinterConfiguration } from '@/zods/printer-configuration';

/*
export const chamberLightingOptions = (
	config?: PartialPrinterConfiguration | null,
): z.infer<typeof ChamberLighting>[] => {
	const options: z.infer<typeof ChamberLighting>[] = [
		{
			id: 'controlboard' as const,
			title: 'Wired to Controlboard',
			badge: [{ color: 'purple', children: config?.controlboard?.name ?? 'Control Board' }],
		},
		{
			id: 'none' as const,
			title: 'None',
		},
	];
	return options;
};

export const defaultChamberLighting = {
	id: 'none' as const,
	title: 'None',
};

export const toolheadAlignmentSystemOptions = (
	config?: PartialPrinterConfiguration | null,
): z.infer<typeof ToolheadAlignmentSystem>[] => {
	const options: z.infer<typeof ToolheadAlignmentSystem>[] = [
		{
			id: 'ratRigVaoc' as const,
			title: 'Rat Rig VAOC',
			badge: [{ color: 'purple', children: config?.controlboard?.name ?? 'Control Board' }],
		},
		{
			id: 'none' as const,
			title: 'None',
		},
	];
	return options;
};

export const defaultToolheadAlignmentSystem = {
	id: 'none' as const,
	title: 'None',
};

export const chamberAirFilterOptions = (
	config?: PartialPrinterConfiguration | null,
): z.infer<typeof ChamberAirFilter>[] => {
	const options: z.infer<typeof ChamberAirFilter>[] = [
		{
			id: 'ratRigRatPack' as const,
			title: 'Rat Rig Rat Pack',
			badge: [{ color: 'purple', children: config?.controlboard?.name ?? 'Control Board' }],
		},
		{
			id: 'none' as const,
			title: 'None',
		},
	];
	return options;
};

export const defaultChamberAirFilter = {
	id: 'none' as const,
	title: 'None',
};
*/
