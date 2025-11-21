import { ToolheadGenerator } from '@/server/helpers/config-generation/toolhead';
import { z } from 'zod';
import { PinMap } from '@/zods/boards';
import { getJsonMetaDirectoryName, JsonMetaHardware } from '@/server/helpers/metadata';
import { getLogger } from '@/server/helpers/logger';
import { getErrorMessage } from '@/utils/exception-handling';

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

export const GetRequiredPinAliasesContext = z.object({
	templateOptions: z.record(z.unknown()),
});

export type GetRequiredPinAliasesContext = z.infer<typeof GetRequiredPinAliasesContext>;

export const RenderTemplateContext = z.object({
	templateOptions: z.record(z.unknown()),
	toolheadGenerator: z.lazy(() => z.instanceof(ToolheadGenerator) as z.ZodType<ToolheadGenerator<boolean>>),
});

export type RenderTemplateContext = z.infer<typeof RenderTemplateContext>;

export const TemplateModule = z.object({
	getRequiredPinAliases: z.function().args(/* ctx */ GetRequiredPinAliasesContext).returns(PinMap.keyof().array()),
	renderTemplate: z
		.function()
		.args(
			/* ctx */
			RenderTemplateContext,
		)
		.returns(z.union([z.string(), z.promise(z.string())])),
});

export type TemplateModule = z.infer<typeof TemplateModule>;
export type GetRequiredPinAliasesFn = TemplateModule['getRequiredPinAliases'];
export type RenderTemplateFn = TemplateModule['renderTemplate'];

/**
 * The base type for hardware used with the Template API.
 * An alias for JsonMetaHardwareType for clarity.
 */
export type TemplateApiHardware = JsonMetaHardware;

export async function renderTemplateAsync(
	hardware: TemplateApiHardware | null | undefined,
	ctx: Omit<RenderTemplateContext, 'templateOptions'>,
): Promise<string | null> {
	if (hardware == null) {
		return null;
	}
	const directoryName = getJsonMetaDirectoryName(hardware);
	let templateModule: TemplateModule;
	try {
		// NOTE: The import argument must be a template literal for webpack to parse it correctly
		/* webpackInclude: /\.ts$/ */
		templateModule = TemplateModule.parse(await import(`./${directoryName}/${hardware.template}`));
	} catch (error) {
		getLogger().error(
			`Failed to load template module for ${hardware.id} from ${directoryName}/${hardware.template}:`,
			error,
		);
		throw new Error(
			`Failed to load template module for ${hardware.id} from ${directoryName}/${hardware.template}: ${getErrorMessage(error)}`,
			{ cause: error },
		);
	}
	try {
		return (
			await Promise.resolve(templateModule.renderTemplate({ ...ctx, templateOptions: hardware.templateOptions ?? {} }))
		).trim();
	} catch (error) {
		getLogger().error(
			`Failed to render template for ${hardware.id} from ${directoryName}/${hardware.template}:`,
			error,
		);
		throw new Error(
			`Failed to render template for ${hardware.id} from ${directoryName}/${hardware.template}: ${getErrorMessage(error)}`,
			{ cause: error },
		);
	}
}
