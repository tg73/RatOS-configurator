import { GetRequiredPinAliasesFn, RenderTemplateFn } from '@/templates/template-api';
import { z } from 'zod';

const Options = z.object({
	isSmart: z.boolean().default(false),
});

export const getRequiredPinAliases: GetRequiredPinAliasesFn = (ctx) => {
	return ['filament_sensor_runout_pin', 'filament_sensor_motion_pin'];
};

export const renderTemplate: RenderTemplateFn = (ctx) => {
	const th = ctx.th;
	const opts = Options.parse(ctx.templateOptions ?? {});
	const runout = `
[filament_switch_sensor filament_sensor${th.printerHasMultipleToolheads ? `_${th.getShortToolName()}` : ''}]
pause_on_runout: False
event_delay: 1.0
switch_pin: ^${th.getPinPrefix()}${th.getPinFromAlias('filament_sensor_runout_pin')}
runout_gcode:
	_ON_TOOLHEAD_FILAMENT_SENSOR_RUNOUT TOOLHEAD=${th.getTool()}
insert_gcode:
	_ON_TOOLHEAD_FILAMENT_SENSOR_INSERT TOOLHEAD=${th.getTool()}
`;
	const button = opts.isSmart
		? `
[gcode_button filament_sensor_button${th.printerHasMultipleToolheads ? `_${th.getShortToolName()}` : ''}]
pin: ^${th.getPinPrefix()}${th.getPinFromAlias('filament_sensor_motion_pin')}
press_gcode:
    {% if (printer.print_stats.state == "printing") %}
        _ON_TOOLHEAD_FILAMENT_SENSOR_CLOG TOOLHEAD=${th.getTool()}
    {% else %}
        _ON_FILAMENT_SENSOR_BUTTON_PRESSED TOOLHEAD=${th.getTool()}
    {% endif %}
release_gcode:
	# No action on release
`
		: `
[gcode_button filament_sensor_button${th.printerHasMultipleToolheads ? `_${th.getShortToolName()}` : ''}]
pin: ^${th.getPinPrefix()}${th.getPinFromAlias('filament_sensor_motion_pin')}
press_gcode:
	_ON_FILAMENT_SENSOR_BUTTON_PRESSED TOOLHEAD=${th.getTool()}
release_gcode:
	# No action on release
`;
	return runout + button;
};
