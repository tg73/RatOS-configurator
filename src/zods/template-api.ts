import { z } from 'zod';
import { serverSchema } from '@/env/schema.mjs';
import { badgeColorOptions } from '@/components/common/badge';

let startsWithServerValidation = '';
if (process.env.RATOS_CONFIGURATION_PATH) {
	const environment = serverSchema.parse(process.env);
	startsWithServerValidation = environment.RATOS_CONFIGURATION_PATH;
}

export const HardwareTypeKey = z.enum([
	'filament-sensor',
	'chamber-lighting',
	'toolhead-alignment-system',
	'chamber-air-filter',
]);

export type HardwareTypeKey = z.infer<typeof HardwareTypeKey>;

/**
 * Base schema corresponding to configuration/hardware-definition-schema.json
 * This represents the abstract definition only.
 */
export const HardwareDefinition = z.object({
	type: HardwareTypeKey,
	title: z.string(),
	description: z.string(),
	manufacturer: z.string(),
	template: z.string(),
	templateOptions: z.record(z.unknown()).optional(),
});

/**
 * Inferred type of the base schema corresponding to configuration/hardware-definition-schema.json
 * This represents the abstract definition only.
 */
export type HardwareDefinition = z.infer<typeof HardwareDefinition>;

/**
 * Base schema for a hardware instance, which includes the id and path to the JSON file, but
 * does not include connection information.
 */
export const UnconnectedHardwareInstance = HardwareDefinition.extend({
	id: z.string(),
	path: z.string().startsWith(startsWithServerValidation).endsWith('.json', { message: "Path must end with '.json'" }),
});

/**
 * Inferred type of the base schema for a hardware instance, which includes the id and path to the JSON file, but
 * does not include connection information.
 */
export type UnconnectedHardwareInstance = z.infer<typeof UnconnectedHardwareInstance>;

/**
 * Base schema for a fully-defined hardware instance used with the Template API, which includes connection information.
 */
export const HardwareInstance = UnconnectedHardwareInstance.extend({
	// Consider adding 'sbc' (single-board computer, eg, rpi) as an option if needed in the future
	connectedTo: z.enum(['toolboard', 'controlboard']),
	badge: z
		.array(
			z.object({
				children: z.string(),
				color: badgeColorOptions,
			}),
		)
		.optional(),
});

export type HardwareInstance = z.infer<typeof HardwareInstance>;

/**
 * Base schema for a hardware instance reference used with the Template API. This includes only the id and connection information,
 * which in combination with the corresponding @see HardwareDefinition is sufficient to reconstruct a full @see HardwareInstance.
 */
export const HardwareInstanceRef = HardwareInstance.pick({ id: true, connectedTo: true }).required().strip();

/**
 * Inferred type of the base schema for a hardware instance reference used with the Template API. This includes only the id and connection information,
 * which in combination with the corresponding @see HardwareDefinition is sufficient to reconstruct a full @see HardwareInstance.
 */
export type HardwareInstanceRef = z.infer<typeof HardwareInstanceRef>;

/**
 * Generates the specialized schema for a specific hardware type used with the Template API.
 * @param literalType - The specific literal string value (e.g., 'filament_sensor').
 * @param extendedDefinitionSchema - A Zod object containing any unique fields for this type (optional).
 */
export function createHardwareSchemas<
	// 1. We allow string so you can overwrite the base enum if needed
	T extends HardwareTypeKey,
	// 2. We default the generic X to an empty object schema
	X extends z.ZodObject<any> = z.ZodObject<{}>,
>(literalType: T, extendedDefinitionSchema?: X) {
	// Normalize: If no specific schema is provided, use an empty object.
	// This ensures the .merge() operations below always happen on a concrete object.
	const extension = extendedDefinitionSchema ?? z.object({});

	// 1. Definition
	// We extend the base to overwrite 'type', then merge any specifics.
	const Definition = HardwareDefinition.extend({ type: z.literal(literalType) }).merge(extension);

	// 2. Unconnected Instance
	// Merge Definition ON TOP of Unconnected to ensure the 'type' literal
	// overrides the base 'type' enum.
	// (Existing keys 'id' and 'path' from Unconnected are preserved)
	const Unconnected = UnconnectedHardwareInstance.merge(Definition);

	// 3. Connected Instance
	// Merge Definition ON TOP of Connected.
	const Connected = HardwareInstance.merge(Definition);

	// 4. References
	// Note that HardwareInstanceRef is already stripped of extra keys.
	// We brand the Ref to make it distinct in the type system, as Ref instances
	// are not interchangeable between different hardware types.

	// TODO: For now, disable branding. Introducing branded types here causes typecheck errors which
	//    despite attempts to fix them, have not been resolved yet. Investigate and re-enable branding later.

	//const Ref = HardwareInstanceRef.brand(`${literalType}_ref` as `${T}_ref`);
	//const OptionalRef = HardwareInstanceRef.brand(`${literalType}_ref` as `${T}_ref`).optional();

	const Ref = HardwareInstanceRef;
	const OptionalRef = HardwareInstanceRef.optional();

	// 5. The Type-Safe Converter
	// This function is hard-coded to only accept the BRANDED Connected type.
	const toRef = (source: z.infer<typeof Connected>): z.infer<typeof Ref> => {
		return Ref.parse(source);
	};

	// 6. The Type-Safe Converter
	// This function is hard-coded to only accept the BRANDED Connected type.
	const toOptionalRef = (source?: z.infer<typeof Connected>): z.infer<typeof OptionalRef> => {
		return OptionalRef.parse(source);
	};

	// Dynamically extract the keys that define a Reference.
	// We use HardwareInstanceRef.shape because it is the unbranded, raw object definition.
	// runtimeKeys = ["id", "connectedTo"]
	const refKeys = Object.keys(HardwareInstanceRef.shape) as (keyof z.infer<typeof Ref>)[];

	// 2. Define the comparison function
	const refEquals = (a: z.infer<typeof Ref> | null | undefined, b: z.infer<typeof Ref> | null | undefined): boolean => {
		// Strict reference check (fast path for same object or both null/undefined)
		if (a === b) return true;

		// If either is null/undefined (but not both, due to check above), they aren't equal
		if (a == null || b == null) return false;

		// Iterate over the specific keys defined by the Schema
		for (const key of refKeys) {
			if (a[key] !== b[key]) {
				return false;
			}
		}

		return true;
	};

	return {
		Definition,
		Unconnected,
		Connected,
		Ref,
		OptionalRef,
		toRef,
		toOptionalRef,
		/**
		 * Type-safe function to compare two hardware instance references for equality. Note that
		 * Ref instances are currently unbranded (see TODO above), so this function can accept any
		 * Ref of the same shape.
		 */
		refEquals,
	};
}
