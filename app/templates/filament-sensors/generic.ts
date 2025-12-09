import { GetRequiredPinAliasesFn, RenderToolheadTemplateFn } from '@/templates/template-api';
import { z } from 'zod';

const Options = z.object({
	invertRunoutPin: z.boolean().default(false),
	pullUpRunoutPin: z.boolean().default(true),
});

export const getRequiredPinAliases: GetRequiredPinAliasesFn = (ctx) => {
	return ['filament_sensor_runout_pin'];
};

export const renderToolheadTemplate: RenderToolheadTemplateFn = (ctx) => {
	const th = ctx.utils.getToolhead(ctx.toolNumber);
	const opts = Options.parse(ctx.templateOptions ?? {});
	return `
[filament_switch_sensor filament_sensor${th.printerHasMultipleToolheads ? `_${th.getShortToolName()}` : ''}]
pause_on_runout: False
event_delay: 1.0
switch_pin: ${opts.invertRunoutPin ? '!' : ''}${opts.pullUpRunoutPin ? '^' : ''}${ctx.getPrefixedPinFromAlias('filament_sensor_runout_pin')}
runout_gcode:
	_ON_TOOLHEAD_FILAMENT_SENSOR_RUNOUT TOOLHEAD=${th.getTool()}
insert_gcode:
	_ON_TOOLHEAD_FILAMENT_SENSOR_INSERT TOOLHEAD=${th.getTool()}
`;
};
