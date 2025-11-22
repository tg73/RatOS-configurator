import { z } from 'zod';
import { serverSchema } from '@/env/schema.mjs';
import { PrinterRailDefinition, Stepper } from '@/zods/motion';
import { badgeColorOptions } from '@/components/common/badge';
import {
	createHardwareSchemas,
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

//----------------------------------------------------------------------------------------
// FilamentSensor
//----------------------------------------------------------------------------------------
export const FilamentSensorSchemas = createHardwareSchemas('filament_sensor');
export const FilamentSensorDefinition = FilamentSensorSchemas.Definition;
export type FilamentSensorDefinition = z.infer<typeof FilamentSensorDefinition>;
export const UnconnectedFilamentSensor = FilamentSensorSchemas.Unconnected;
export type UnconnectedFilamentSensor = z.infer<typeof UnconnectedFilamentSensor>;
export const FilamentSensor = FilamentSensorSchemas.Connected;
export type FilamentSensor = z.infer<typeof FilamentSensor>;
/**
 * Use {@link FilamentSensorSchemas.toRef} to obtain references to {@link FilamentSensor} instances.
 */
export const FilamentSensorRef = FilamentSensorSchemas.Ref;
/**
 * Use {@link FilamentSensorSchemas.toRef} to obtain references to {@link FilamentSensor} instances.
 */
export type FilamentSensorRef = z.infer<typeof FilamentSensorRef>;
/**
 * Use {@link FilamentSensorSchemas.toRef} to obtain references to {@link FilamentSensor} instances.
 */
export const OptionalFilamentSensorRef = FilamentSensorSchemas.OptionalRef;
/**
 * Use {@link FilamentSensorSchemas.toRef} to obtain references to {@link FilamentSensor} instances.
 */
export type OptionalFilamentSensorRef = z.infer<typeof OptionalFilamentSensorRef>;

//----------------------------------------------------------------------------------------
// ChamberLighting
//----------------------------------------------------------------------------------------
export const ChamberLightingSchemas = createHardwareSchemas('chamber_lighting');
export const ChamberLightingDefinition = ChamberLightingSchemas.Definition;
export type ChamberLightingDefinition = z.infer<typeof ChamberLightingDefinition>;
export const UnconnectedChamberLighting = ChamberLightingSchemas.Unconnected;
export type UnconnectedChamberLighting = z.infer<typeof UnconnectedChamberLighting>;
export const ChamberLighting = ChamberLightingSchemas.Connected;
export type ChamberLighting = z.infer<typeof ChamberLighting>;
/**
 * Use {@link ChamberLightingSchemas.toRef} to obtain references to {@link ChamberLighting} instances.
 */
export const ChamberLightingRef = ChamberLightingSchemas.Ref;
/**
 * Use {@link ChamberLightingSchemas.toRef} to obtain references to {@link ChamberLighting} instances.
 */
export type ChamberLightingRef = z.infer<typeof ChamberLightingRef>;
/**
 * Use {@link ChamberLightingSchemas.toRef} to obtain references to {@link ChamberLighting} instances.
 */
export const OptionalChamberLightingRef = ChamberLightingSchemas.OptionalRef;
/**
 * Use {@link ChamberLightingSchemas.toRef} to obtain references to {@link ChamberLighting} instances.
 */
export type OptionalChamberLightingRef = z.infer<typeof OptionalChamberLightingRef>;

//----------------------------------------------------------------------------------------
// ChamberAirFilter
//----------------------------------------------------------------------------------------
export const ChamberAirFilterSchemas = createHardwareSchemas('chamber_air_filter');
export const ChamberAirFilterDefinition = ChamberAirFilterSchemas.Definition;
export type ChamberAirFilterDefinition = z.infer<typeof ChamberAirFilterDefinition>;
export const UnconnectedChamberAirFilter = ChamberAirFilterSchemas.Unconnected;
export type UnconnectedChamberAirFilter = z.infer<typeof UnconnectedChamberAirFilter>;
export const ChamberAirFilter = ChamberAirFilterSchemas.Connected;
export type ChamberAirFilter = z.infer<typeof ChamberAirFilter>;
/**
 * Use {@link ChamberAirFilterSchemas.toRef} to obtain references to {@link ChamberAirFilter} instances.
 */
export const ChamberAirFilterRef = ChamberAirFilterSchemas.Ref;
/**
 * Use {@link ChamberAirFilterSchemas.toRef} to obtain references to {@link ChamberAirFilter} instances.
 */
export type ChamberAirFilterRef = z.infer<typeof ChamberAirFilterRef>;
/**
 * Use {@link ChamberAirFilterSchemas.toRef} to obtain references to {@link ChamberAirFilter} instances.
 */
export const OptionalChamberAirFilterRef = ChamberAirFilterSchemas.OptionalRef;
/**
 * Use {@link ChamberAirFilterSchemas.toRef} to obtain references to {@link ChamberAirFilter} instances.
 */
export type OptionalChamberAirFilterRef = z.infer<typeof OptionalChamberAirFilterRef>;

//----------------------------------------------------------------------------------------
// ToolheadAlignmentSystem
//----------------------------------------------------------------------------------------
export const ToolheadAlignmentSystemSchemas = createHardwareSchemas('toolhead_alignment_system');
export const ToolheadAlignmentSystemDefinition = ToolheadAlignmentSystemSchemas.Definition;
export type ToolheadAlignmentSystemDefinition = z.infer<typeof ToolheadAlignmentSystemDefinition>;
export const UnconnectedToolheadAlignmentSystem = ToolheadAlignmentSystemSchemas.Unconnected;
export type UnconnectedToolheadAlignmentSystem = z.infer<typeof UnconnectedToolheadAlignmentSystem>;
export const ToolheadAlignmentSystem = ToolheadAlignmentSystemSchemas.Connected;
export type ToolheadAlignmentSystem = z.infer<typeof ToolheadAlignmentSystem>;
/**
 * Use {@link ToolheadAlignmentSystemSchemas.toRef} to obtain references to {@link ToolheadAlignmentSystem} instances.
 */
export const ToolheadAlignmentSystemRef = ToolheadAlignmentSystemSchemas.Ref;
/**
 * Use {@link ToolheadAlignmentSystemSchemas.toRef} to obtain references to {@link ToolheadAlignmentSystem} instances.
 */
export type ToolheadAlignmentSystemRef = z.infer<typeof ToolheadAlignmentSystemRef>;
/**
 * Use {@link ToolheadAlignmentSystemSchemas.toRef} to obtain references to {@link ToolheadAlignmentSystem} instances.
 */
export const OptionalToolheadAlignmentSystemRef = ToolheadAlignmentSystemSchemas.OptionalRef;
/**
 * Use {@link ToolheadAlignmentSystemSchemas.toRef} to obtain references to {@link ToolheadAlignmentSystem} instances.
 */
export type OptionalToolheadAlignmentSystemRef = z.infer<typeof OptionalToolheadAlignmentSystemRef>;
