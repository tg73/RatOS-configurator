import { ToolheadGenerator } from '@/server/helpers/config-generation/toolhead';

export const template = (toolhead: ToolheadGenerator<boolean>) => {
	const sensor = toolhead.getFilamentSensor();
	if (sensor == null) {
		throw new Error('Filament sensor is not configured');
	}
	return `
[filament_switch_sensor filament_sensor${toolhead.printerHasMultipleToolheads ? `_${toolhead.getShortToolName()}` : ''}]
pause_on_runout: False
event_delay: 1.0
switch_pin: ^${toolhead.getPinFromAlias(sensor.sensePinAlias)}
runout_gcode:
	_ON_TOOLHEAD_FILAMENT_SENSOR_RUNOUT TOOLHEAD=${toolhead.getTool()}}
insert_gcode:
	_ON_TOOLHEAD_FILAMENT_SENSOR_INSERT TOOLHEAD=${toolhead.getTool()}
  
[gcode_button filament_sensor_button${toolhead.printerHasMultipleToolheads ? `_${toolhead.getShortToolName()}` : ''}]
pin: ^${toolhead.getPinFromAlias(sensor.buttonPinAlias)}
press_gcode:
    {% if (printer.print_stats.state == "printing") %}
        _ON_TOOLHEAD_FILAMENT_SENSOR_CLOG TOOLHEAD=${toolhead.getTool()}
    {% else %}
        _ON_FILAMENT_SENSOR_BUTTON_PRESSED TOOLHEAD=${toolhead.getTool()}
    {% endif %}
release_gcode:
	# No action on release
`;
};
