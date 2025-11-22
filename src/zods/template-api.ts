import { z } from 'zod';
import { serverSchema } from '@/env/schema.mjs';
import { badgeColorOptions } from '@/components/common/badge';

let startsWithServerValidation = '';
if (process.env.RATOS_CONFIGURATION_PATH) {
	const environment = serverSchema.parse(process.env);
	startsWithServerValidation = environment.RATOS_CONFIGURATION_PATH;
}

// TODO: Avoid duplicating the list of supported types (or related constants) between here and src/server/helpers/metadata.ts

/**
 * Base schema corresponding to configuration/hardware-definition-schema.json
 * This represents the abstract definition only.
 */
export const HardwareDefinition = z.object({
	type: z.enum(['filament_sensor', 'chamber_lighting', 'toolhead_alignment_system', 'chamber_air_filter']),
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
 * THIS DOES NOT WORK AS EXPECTED! It would be nice to have, but Zod struggles infer types from generics in this way.
 *
 * Generates the three specialized schema levels (Definition, Unconnected, Connected)
 * for a given literal type string. Assumes that the Ref schema is the same for all types (for now).
 * @param literalType - The specific literal string value (e.g., 'filament_sensor').
 * @param specificSchema - A Zod object containing any unique fields for this type (optional).
 */
function createHardwareSchemas<T extends z.infer<typeof HardwareDefinition>['type'], S extends z.ZodObject<any>>(
	literalType: T,
	specificSchema?: S,
) {
	// 1. Specialized Definition: HardwareDefinition + the specific literal type
	const SpecializedDefinition =
		specificSchema == null
			? HardwareDefinition.extend({
					type: z.literal(literalType),
				})
			: HardwareDefinition.extend({
					type: z.literal(literalType),
				}).merge(specificSchema); // Merge specific fields like 'pin', 'runout_logic', etc.

	// 2. Unconnected Instance: UnconnectedHardwareInstance + SpecializedDefinition
	const SpecializedUnconnected = UnconnectedHardwareInstance.merge(SpecializedDefinition);

	// 3. Connected Instance: HardwareInstance + SpecializedDefinition
	const SpecializedConnected = HardwareInstance.merge(SpecializedDefinition);

	// 4. Reference: Reuse the common Ref structure
	const Ref = HardwareInstanceRef;

	return {
		Definition: SpecializedDefinition,
		Unconnected: SpecializedUnconnected,
		Connected: SpecializedConnected,
		Ref: Ref,
	};
}
