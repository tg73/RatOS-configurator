import { ToolheadGenerator } from '@/server/helpers/config-generation/toolhead';
import { z } from 'zod';
import { PinMap } from '@/zods/boards';
import { getJsonMetaDirectoryName, JsonMetaHardware } from '@/server/helpers/metadata';
import { getLogger } from '@/server/helpers/logger';
import { getErrorMessage } from '@/utils/exception-handling';
import { HardwareInstance } from '@/zods/template-api';
import { KlipperConfigUtils } from '@/server/helpers/klipper-config';
import { ToolNumber } from '@/zods/toolhead';

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

// Note: The current GetRequiredPinAliasesFn and GetRequiredPinAliasesContext concept is adequate
// for the hardware types currently using the Template API, but may need to be revisited
// if more varied hardware types are added that require additional context for pin alias resolution,
// or where building the list of valid options can't be done purely by filtering based on a list
// of pin aliases. Note also the existing general restirction (not Template API-specific) that
// only T0 can be used without a toolboard, and bear that in mind when contemplating future extensions.

export const GetRequiredPinAliasesContext = z.object({
	templateOptions: z.record(z.unknown()),
});

export type GetRequiredPinAliasesContext = z.infer<typeof GetRequiredPinAliasesContext>;

const GetPrefixedPinFromAliasFn = z
	.function()
	.describe(
		'Function that maps a pin alias (from PinMap) to an actual pin name, with a toolboard prefix ' +
			'when applicable, depending on the where the current hardware instance is connected.',
	)
	.args(PinMap.keyof())
	.returns(z.string());

type GetPrefixedPinFromAliasFn = z.infer<typeof GetPrefixedPinFromAliasFn>;

export const RenderTemplateContext = z.object({
	instance: HardwareInstance,
	purpose: z
		.string()
		.describe(
			'The purpose of the template rendering, if applicable. Most templates will ignore this. Currently, ' +
				'the "purpose" concept is used by a limited number of arguably over-coupled software patterns, ' +
				'but the intention is to make it more general in the future, once the dust has settled and ' +
				'use cases have emerged.',
		)
		.optional(),
	templateOptions: z.record(z.unknown()),
	getPrefixedPinFromAlias: GetPrefixedPinFromAliasFn,
	utils: z.custom<KlipperConfigUtils>(),
});

export type RenderTemplateContext = z.infer<typeof RenderTemplateContext>;

export const RenderTemplateFn = z
	.function()
	.args(
		/* ctx */
		RenderTemplateContext,
	)
	.returns(z.union([z.string(), z.promise(z.string())]));

export type RenderTemplateFn = z.infer<typeof RenderTemplateFn>;

export const RenderToolheadTemplateContext = RenderTemplateContext.extend({
	toolNumber: ToolNumber,
	//toolheadGenerator: z.lazy(() => z.instanceof(ToolheadGenerator) as z.ZodType<ToolheadGenerator<boolean>>),
});

export type RenderToolheadTemplateContext = z.infer<typeof RenderToolheadTemplateContext>;

export const RenderToolheadTemplateFn = z
	.function()
	.args(
		/* ctx */
		RenderToolheadTemplateContext,
	)
	.returns(z.union([z.string(), z.promise(z.string())]));

export type RenderToolheadTemplateFn = z.infer<typeof RenderToolheadTemplateFn>;

export const GetRequiredPinAliasesFn = z
	.function()
	.args(
		/* ctx */
		GetRequiredPinAliasesContext,
	)
	.returns(PinMap.keyof().array());

export type GetRequiredPinAliasesFn = z.infer<typeof GetRequiredPinAliasesFn>;

export const TemplateModule = z
	.object({
		getRequiredPinAliases: GetRequiredPinAliasesFn,
		renderTemplate: RenderTemplateFn.optional(),
		renderToolheadTemplate: RenderToolheadTemplateFn.optional(),
	})
	.superRefine((obj, ctx) => {
		if (!obj.renderTemplate && !obj.renderToolheadTemplate) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'At least one of renderTemplate or renderToolheadTemplate must be defined',
			});
		}
	});

export type TemplateModule = z.infer<typeof TemplateModule>;

export async function renderTemplateAsync(
	instance: HardwareInstance | null | undefined,
	ctx: Omit<RenderTemplateContext, 'templateOptions' | 'instance' | 'getPrefixedPinFromAlias'>,
	toolNumber?: ToolNumber,
): Promise<string | null> {
	if (instance == null) {
		return null;
	}
	const directoryName = getJsonMetaDirectoryName(instance);
	let templateModule: TemplateModule;
	try {
		// NOTE: The import argument must be a template literal for webpack to parse it correctly
		/* webpackInclude: /\.ts$/ */
		templateModule = TemplateModule.parse(await import(`./${directoryName}/${instance.template}`));
	} catch (error) {
		getLogger().error(
			`Failed to load template module for ${instance.id} from ${directoryName}/${instance.template}:`,
			error,
		);
		throw new Error(
			`Failed to load template module for ${instance.id} from ${directoryName}/${instance.template}: ${getErrorMessage(error)}`,
			{ cause: error },
		);
	}

	if (toolNumber != null && !templateModule.renderToolheadTemplate) {
		getLogger().error(
			`Template module for ${instance.id} from ${directoryName}/${instance.template} does not export renderToolheadTemplate`,
		);
		throw new Error(
			`Template module for ${instance.id} from ${directoryName}/${instance.template} does not export renderToolheadTemplate`,
		);
	}

	if (toolNumber == null) {
		if (!templateModule.renderTemplate) {
			getLogger().error(
				`Template module for ${instance.id} from ${directoryName}/${instance.template} does not export renderTemplate`,
			);
			throw new Error(
				`Template module for ${instance.id} from ${directoryName}/${instance.template} does not export renderTemplate`,
			);
		}
		if (instance.connectedTo === 'toolboard') {
			getLogger().error(
				`Template module for ${instance.id} from ${directoryName}/${instance.template} is connected to a toolboard but no tool number was provided`,
			);
			throw new Error(
				`Template module for ${instance.id} from ${directoryName}/${instance.template} is connected to a toolboard but no tool number was provided`,
			);
		}
	}

	const getPrefixedPinFromAlias: GetPrefixedPinFromAliasFn =
		toolNumber == null
			? (alias) => {
					const pin = ctx.utils.getControlboardPins()?.[alias];
					if (!pin) {
						throw new Error(
							`No pin found for alias "${alias}" while rendering template for ${instance.type} ${instance.id} connected to ${instance.connectedTo}`,
						);
					}
					return pin;
				}
			: (alias) => {
					let pin: string | undefined;
					if (instance.connectedTo === 'controlboard') {
						pin = ctx.utils.getControlboardPins()?.[alias];
					} else {
						const th = ctx.utils.getToolhead(toolNumber);
						pin = th.getToolboardPins()[alias];
						if (pin) {
							pin = `${th.getToolboardName()}:${pin}`;
						}
					}
					if (!pin) {
						throw new Error(
							`No pin found for alias "${alias}" while rendering template for T${toolNumber} ${instance.type} ${instance.id} connected to ${instance.connectedTo}`,
						);
					}
					return pin;
				};

	try {
		return (
			await Promise.resolve(
				toolNumber == null
					? templateModule.renderTemplate!({
							...ctx,
							instance,
							getPrefixedPinFromAlias,
							templateOptions: instance.templateOptions ?? {},
						})
					: templateModule.renderToolheadTemplate!({
							...ctx,
							instance,
							toolNumber,
							getPrefixedPinFromAlias,
							templateOptions: instance.templateOptions ?? {},
						}),
			)
		).trim();
	} catch (error) {
		getLogger().error(
			`Failed to render template for ${instance.id} from ${directoryName}/${instance.template}:`,
			error,
		);
		throw new Error(
			`Failed to render template for ${instance.id} from ${directoryName}/${instance.template}: ${getErrorMessage(error)}`,
			{ cause: error },
		);
	}
}
