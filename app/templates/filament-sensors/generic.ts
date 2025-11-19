import { ToolheadGenerator } from '@/server/helpers/config-generation/toolhead';
import { z } from 'zod';

const TemplateProperties = z.object({
	invertSensePin: z.boolean().default(false),
	invertButtonPin: z.boolean().default(false),
	pullUpSensePin: z.boolean().default(true),
	pullUpButtonPin: z.boolean().default(true),
});

export const template = (toolhead: ToolheadGenerator<boolean>) => {
	const sensor = toolhead.getFilamentSensor();
	if (sensor == null) {
		throw new Error('Filament sensor is not configured');
	}
	const props = TemplateProperties.parse(sensor.templateProperties);
	const sense = `
[filament_switch_sensor filament_sensor${toolhead.printerHasMultipleToolheads ? `_${toolhead.getShortToolName()}` : ''}]
pause_on_runout: False
event_delay: 1.0
switch_pin: ${props.invertSensePin ? '!' : ''}${props.pullUpSensePin ? '^' : ''}${toolhead.getPinFromAlias(sensor.sensePinAlias)}
runout_gcode:
	_ON_TOOLHEAD_FILAMENT_SENSOR_RUNOUT TOOLHEAD=${toolhead.getTool()}
insert_gcode:
	_ON_TOOLHEAD_FILAMENT_SENSOR_INSERT TOOLHEAD=${toolhead.getTool()}
`;
	if (sensor.hasButton) {
		const button = `
[gcode_button filament_sensor_button${toolhead.printerHasMultipleToolheads ? `_${toolhead.getShortToolName()}` : ''}]
pin: ${props.invertButtonPin ? '!' : ''}${props.pullUpButtonPin ? '^' : ''}${toolhead.getPinFromAlias(sensor.buttonPinAlias)}
press_gcode:
	_ON_FILAMENT_SENSOR_BUTTON_PRESSED TOOLHEAD=${toolhead.getTool()}
release_gcode:
	# No action on release
`;
		return sense + button;
	} else {
		return sense;
	}
};
