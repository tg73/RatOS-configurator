import { ToolheadGenerator } from '@/server/helpers/config-generation/toolhead';
import { z } from 'zod';
import { PinMap } from '@/zods/boards';

/*
 * Here we define the new server-only template API.
 * The API is currently used only by filament sensor templates,
 * but the intention is to expand it to other template types in the future.
 *
 * Notably, printer templates, which inspired the template pattern used with
 * filament sensors, are not currently using this API.
 */

// The renderTemplate context object could be extended in the future if needed, eg with
// KlipperConfigUtils, KlipperConfigExtrasGenerator, KlipperConfigHelper

export const TemplateModule = z.object({
	getRequiredPinAliases: z
		.function()
		.args(/* ctx */ z.object({ templateOptions: z.record(z.unknown()) }))
		.returns(PinMap.keyof().array()),
	renderTemplate: z
		.function()
		.args(
			/* ctx */
			z.object({
				templateOptions: z.record(z.unknown()),
				th: z.lazy(() => z.instanceof(ToolheadGenerator) as z.ZodType<ToolheadGenerator<boolean>>),
			}),
		)
		.returns(z.union([z.string(), z.promise(z.string())])),
});

export type TemplateModule = z.infer<typeof TemplateModule>;
export type GetRequiredPinAliasesFn = TemplateModule['getRequiredPinAliases'];
export type RenderTemplateFn = TemplateModule['renderTemplate'];
