import { z } from 'zod';
import { serverSchema } from '@/env/schema.mjs';
import { PrinterRailDefinition, Stepper } from '@/zods/motion';
import { badgeColorOptions } from '@/components/common/badge';
import {
	HardwareDefinition,
	HardwareInstance,
	HardwareInstanceRef,
	UnconnectedHardwareInstance,
} from '@/zods/template-api';

export const thermistors = [
	'EPCOS 100K B57560G104F',
	'ATC Semitec 104GT-2',
	'ATC Semitec 104NT-4-R025H42G',
	'Generic 3950',
	'Honeywell 100K 135-104LAG-J01',
	'NTC 100K MGB18-104F39050L32',
	'SliceEngineering 450',
	'TDK NTCG104LH104JT1',
	'PT1000',
] as const;

let startsWithServerValidation = '';
if (process.env.RATOS_CONFIGURATION_PATH) {
	const environment = serverSchema.parse(process.env);
	startsWithServerValidation = environment.RATOS_CONFIGURATION_PATH;
}
const hardwareType = z.object({
	path: z
		.string()
		.startsWith(startsWithServerValidation)
		.regex(/\.(cfg|json)$/, { message: "Path must end with '.cfg' or '.json'" }),
	id: z.string(),
});

export const Thermistor = z.enum(thermistors);

export const Hotend = hardwareType.extend({
	type: z.literal('hotend'),
	title: z.string(),
	thermistor: z.enum(thermistors),
	flowType: z.union([z.literal('sf'), z.literal('hf'), z.literal('uhf')]),
});

export const Nozzle = z.object({
	type: z.enum(['Regular', 'CHT']),
	diameter: z.number().min(0.2).max(1.8),
});

export const Extruder = hardwareType.extend({
	type: z.literal('extruder'),
	stepper: Stepper.shape.id.optional(),
	current: PrinterRailDefinition.shape.current.optional(),
	title: z.string(),
});

export const Probe = hardwareType.extend({
	type: z.literal('static-probe').or(z.literal('stowable-probe')),
	title: z.string(),
});

export const Endstop = z.object({
	id: z.enum(['endstop', 'endstop-toolboard', 'sensorless']),
	title: z.string(),
	badge: z
		.array(
			z.object({
				children: z.string(),
				color: badgeColorOptions,
			}),
		)
		.optional(),
});

export const KlipperAccelSensorNameSchame = z.union([
	z.literal('toolboard_t0'),
	z.literal('toolboard_t1'),
	z.literal('controlboard'),
	z.literal('rpi'),
	z.literal('beacon'),
]);

export const AccelerometerType = z.union([z.literal('adxl345'), z.literal('lis2dw'), z.literal('beacon')]);

export const Accelerometer = z.object({
	id: z.enum(['toolboard', 'controlboard', 'sbc', 'none', 'beacon']),
	title: z.string(),
	accelerometerType: AccelerometerType.default('adxl345').optional(),
});

export type KlipperAccelSensorName = z.infer<typeof KlipperAccelSensorNameSchame>;

export const klipperAccelSensorSchema = z.object({
	name: KlipperAccelSensorNameSchame,
	type: AccelerometerType,
});

export type KlipperAccelSensorSchema = z.infer<typeof klipperAccelSensorSchema>;

export const AccelerometerWithType = Accelerometer.extend({
	accelerometerType: AccelerometerType,
});

export type AccelerometerWithType = z.infer<typeof AccelerometerWithType>;

export const Fan = z.object({
	id: z.enum([
		'2pin',
		'4pin',
		'4pin-dedicated',
		'2pin-toolboard',
		'4pin-toolboard',
		'4pin-dedicated-toolboard',
		'none',
	]),
	title: z.string(),
	badge: z
		.array(
			z.object({
				children: z.string(),
				color: badgeColorOptions,
			}),
		)
		.optional(),
});

//---------------- Template API Types ------------------

// NB: I attempted to generalize the pattern below (see createHardwareSchemas in zods/template-api.ts)
// but Zod struggled to infer the types correctly.

export const FilamentSensorDefinition = HardwareDefinition.extend({
	type: z.literal('filament-sensor'),
});
export type FilamentSensorDefinition = z.infer<typeof FilamentSensorDefinition>;

export const UnconnectedFilamentSensor = UnconnectedHardwareInstance.merge(FilamentSensorDefinition);
export type UnconnectedFilamentSensor = z.infer<typeof UnconnectedFilamentSensor>;

export const FilamentSensor = HardwareInstance.merge(FilamentSensorDefinition);
export type FilamentSensor = z.infer<typeof FilamentSensor>;

export const FilamentSensorRef = HardwareInstanceRef;
export type FilamentSensorRef = z.infer<typeof FilamentSensorRef>;

export const ChamberLightingDefinition = HardwareDefinition.extend({
	type: z.literal('chamber-lighting'),
});
export type ChamberLightingDefinition = z.infer<typeof ChamberLightingDefinition>;

export const UnconnectedChamberLighting = UnconnectedHardwareInstance.merge(ChamberLightingDefinition);
export type UnconnectedChamberLighting = z.infer<typeof UnconnectedChamberLighting>;

export const ChamberLighting = HardwareInstance.merge(ChamberLightingDefinition);
export type ChamberLighting = z.infer<typeof ChamberLighting>;

export const ChamberLightingRef = HardwareInstanceRef;
export type ChamberLightingRef = z.infer<typeof ChamberLightingRef>;

export const ToolheadAlignmentSystemDefinition = HardwareDefinition.extend({
	type: z.literal('toolhead-alignment-system'),
});
export type ToolheadAlignmentSystemDefinition = z.infer<typeof ToolheadAlignmentSystemDefinition>;

export const UnconnectedToolheadAlignmentSystem = UnconnectedHardwareInstance.merge(ToolheadAlignmentSystemDefinition);
export type UnconnectedToolheadAlignmentSystem = z.infer<typeof UnconnectedToolheadAlignmentSystem>;

export const ToolheadAlignmentSystem = HardwareInstance.merge(ToolheadAlignmentSystemDefinition);
export type ToolheadAlignmentSystem = z.infer<typeof ToolheadAlignmentSystem>;

export const ToolheadAlignmentSystemRef = HardwareInstanceRef;
export type ToolheadAlignmentSystemRef = z.infer<typeof ToolheadAlignmentSystemRef>;

export const ChamberAirFilterDefinition = HardwareDefinition.extend({
	type: z.literal('chamber-air-filter'),
});
export type ChamberAirFilterDefinition = z.infer<typeof ChamberAirFilterDefinition>;

export const UnconnectedChamberAirFilter = UnconnectedHardwareInstance.merge(ChamberAirFilterDefinition);
export type UnconnectedChamberAirFilter = z.infer<typeof UnconnectedChamberAirFilter>;

export const ChamberAirFilter = HardwareInstance.merge(ChamberAirFilterDefinition);
export type ChamberAirFilter = z.infer<typeof ChamberAirFilter>;

export const ChamberAirFilterRef = HardwareInstanceRef;
export type ChamberAirFilterRef = z.infer<typeof ChamberAirFilterRef>;
