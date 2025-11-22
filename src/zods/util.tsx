import { z } from 'zod';

export const PinoLogLevel = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

export const PinoLogEvent = z.object({
	ts: z.number(),
	messages: z.array(z.any()),
	bindings: z.array(z.record(z.string(), z.any())),
	level: z.object({
		label: PinoLogLevel,
		value: z.number(),
	}),
});

/**
 * A utility type to "prettify" complex TypeScript types for improved readability in IDEs.
 * @example
 * BEFORE: Tooltip might show 'HardwareInstance & { type: ... }'
 * type MyType = z.infer<typeof FilamentSensor>;
 *
 * AFTER: Tooltip shows '{ id: string; type: "filament_sensor"; ... }'
 * type MyType = Prettify<z.infer<typeof FilamentSensor>>;
 */
export type Prettify<T> = {
	[K in keyof T]: T[K];
} & {};

/**
 * A utility type to "prettify" complex TypeScript types for improved readability in IDEs,
 * for complex nested objects.
 * @example
 * BEFORE: Tooltip might show 'HardwareInstance & { type: ... }'
 * type MyType = z.infer<typeof FilamentSensor>;
 *
 * AFTER: Tooltip shows '{ id: string; type: "filament_sensor"; ... }'
 * type MyType = Prettify<z.infer<typeof FilamentSensor>>;
 */
export type PrettifyDeep<T> = {
	[K in keyof T]: T[K] extends object ? PrettifyDeep<T[K]> : T[K];
} & {};
