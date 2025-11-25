import { z } from 'zod';
import { BoardID, Toolboard } from '@/zods/boards';
import {
	Hotend,
	Thermistor,
	Extruder,
	Probe,
	Endstop,
	Fan,
	Accelerometer,
	Nozzle,
	FilamentSensor,
	FilamentSensorRef,
} from '@/zods/hardware';
import { PrinterAxis } from '@/zods/motion';
import { getDefaultNozzle } from '@/data/nozzles';

// Was Accelerometer.optional().nullable(), which:
//   a) uses optional/nullable ordering incorrectly and
//   b) adds unnecessary complexity/confusion around undefined vs null
// Now normalizing to undefined when not set, with tranform in place to handle null inputs
// which may be encountered during deserialization in the wild.
const GracefulOptionalAccelerometer = z
	.union([Accelerometer.optional(), z.literal(null)])
	.transform((val) => (val === null ? undefined : val));

export const BaseToolheadConfiguration = z
	.object({
		hotend: Hotend,
		thermistor: Thermistor,
		extruder: Extruder,
		xEndstop: Endstop,
		yEndstop: Endstop,
		hotendFan: Fan,
		partFan: Fan,
		nozzle: Nozzle.default(getDefaultNozzle()),
		xAccelerometer: GracefulOptionalAccelerometer,
		yAccelerometer: GracefulOptionalAccelerometer,
		toolboard: Toolboard.nullable(),
		probe: Probe.optional(),
		filamentSensor: FilamentSensor.optional(),
		axis: z.literal(PrinterAxis.x).or(z.literal(PrinterAxis.dual_carriage)),
		description: z.string().optional(),
		toolNumber: z.number().optional(),
	})
	.strict();

export const ToolNumber = z.union([z.literal(0), z.literal(1)]);
export const ToolAxis = z.union([
	z.literal(PrinterAxis.x),
	z.literal(PrinterAxis.dual_carriage),
	z.literal(PrinterAxis.extruder),
	z.literal(PrinterAxis.extruder1),
]);
export const ToolOrAxis = z.union([ToolAxis, ToolNumber]);
export type ToolNumber = z.infer<typeof ToolNumber>;
export type ToolAxis = z.infer<typeof ToolAxis>;
export type ToolOrAxis = z.infer<typeof ToolOrAxis>;

export const ToolheadConfiguration = BaseToolheadConfiguration.refine(
	(data) => data.toolboard !== null || data.xEndstop.id !== 'endstop-toolboard',
	'Cannot use toolboard endstop without a toolboard',
)
	.refine(
		(data) =>
			data.toolboard !== null ||
			!['2pin-toolboard', '4pin-toolboard', '4pin-dedicated-toolboard'].includes(data.hotendFan.id),
		'Cannot use toolboard hotend fan without a toolboard',
	)
	.refine(
		(data) =>
			data.toolboard !== null ||
			!['2pin-toolboard', '4pin-toolboard', '4pin-dedicated-toolboard'].includes(data.partFan.id),
		'Cannot use toolboard part cooling fan without a toolboard',
	);

export const PartialToolheadConfiguration = BaseToolheadConfiguration.partial().optional();
export const SerializedToolheadConfiguration = BaseToolheadConfiguration.extend({
	hotend: Hotend.shape.id,
	extruder: Extruder.shape.id,
	thermistor: Thermistor,
	xEndstop: Endstop.shape.id,
	yEndstop: Endstop.shape.id,
	hotendFan: Fan.shape.id,
	partFan: Fan.shape.id,
	xAccelerometer: Accelerometer.shape.id.optional().nullable(),
	yAccelerometer: Accelerometer.shape.id.optional().nullable(),
	toolboard: BoardID.optional().nullable(),
	probe: Probe.shape.id.optional().nullable(),
	// TODO: Can we drop nullable() here? This is a new property so there shouldn't be any existing nulls to handle.
	filamentSensor: FilamentSensorRef.optional().nullable(),
}).strict();
export const SerializedPartialToolheadConfiguration = SerializedToolheadConfiguration.partial().optional();

export type ToolheadConfiguration<T extends boolean> = z.infer<typeof ToolheadConfiguration> & {
	toolboard: T extends true ? Toolboard : null;
};
export type PartialToolheadConfiguration = z.infer<typeof PartialToolheadConfiguration>;
export type SerializedToolheadConfiguration = z.infer<typeof SerializedToolheadConfiguration>;
export type SerializedPartialToolheadConfiguration = z.infer<typeof SerializedPartialToolheadConfiguration>;
