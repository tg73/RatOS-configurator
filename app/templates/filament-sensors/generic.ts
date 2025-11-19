import { ToolheadGenerator } from '@/server/helpers/config-generation/toolhead';
import { z } from 'zod';

const TemplateProperties = z.object({
	invertSensePin: z.boolean().default(false),
	invertButtonPin: z.boolean().default(false),
	pullUpSensePin: z.boolean().default(true),
	pullUpButtonPin: z.boolean().default(true),
});

export const template = (th: ToolheadGenerator<boolean>) => {
	const sensor = th.getFilamentSensor();
	if (sensor == null) {
		throw new Error('Filament sensor is not configured');
	}
	const props = TemplateProperties.parse(sensor.templateProperties ?? {});
	const sense = `
[filament_switch_sensor filament_sensor${th.printerHasMultipleToolheads ? `_${th.getShortToolName()}` : ''}]
pause_on_runout: False
event_delay: 1.0
switch_pin: ${props.invertSensePin ? '!' : ''}${props.pullUpSensePin ? '^' : ''}${th.getPinPrefix()}${th.getPinFromAlias(sensor.sensePinAlias)}
runout_gcode:
	_ON_TOOLHEAD_FILAMENT_SENSOR_RUNOUT TOOLHEAD=${th.getTool()}
insert_gcode:
	_ON_TOOLHEAD_FILAMENT_SENSOR_INSERT TOOLHEAD=${th.getTool()}
`;
	if (sensor.hasButton) {
		const button = `
[gcode_button filament_sensor_button${th.printerHasMultipleToolheads ? `_${th.getShortToolName()}` : ''}]
pin: ${props.invertButtonPin ? '!' : ''}${props.pullUpButtonPin ? '^' : ''}${th.getPinPrefix()}${th.getPinFromAlias(sensor.buttonPinAlias)}
press_gcode:
	_ON_FILAMENT_SENSOR_BUTTON_PRESSED TOOLHEAD=${th.getTool()}
release_gcode:
	# No action on release
`;
		return sense + button;
	} else {
		return sense;
	}
};
