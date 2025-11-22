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
 * A type-safe wrapper around Zod's {@link z.ZodType.parse} function (which by desgin accepts `unknown`). Use
 * this function when using Zod to project between types, rather than validating unknown data.
 * A common use case is going from a full type like `FilamentSensor`, to a reference type like
 * `OptionalFilamentSensorRef`. The `OptionalFilamentSensorRef` schema will strip unwanted keys.
 * In this example, where Zod's `parse` would accept `null`, `project` will not, instead giving
 * a type error at compile time.
 */
export function project<T extends z.ZodType>(schema: T, source: z.infer<T>): z.infer<T> {
	return schema.parse(source);
}
