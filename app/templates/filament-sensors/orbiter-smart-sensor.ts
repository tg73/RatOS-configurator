import { ToolheadGenerator } from '@/server/helpers/config-generation/toolhead';

export const template = (th: ToolheadGenerator<boolean>) => {
	const sensor = th.getFilamentSensor();
	if (sensor == null) {
		throw new Error('Filament sensor is not configured');
	}
	return `
[filament_switch_sensor filament_sensor${th.printerHasMultipleToolheads ? `_${th.getShortToolName()}` : ''}]
pause_on_runout: False
event_delay: 1.0
switch_pin: ^${th.getPinPrefix()}${th.getPinFromAlias(sensor.sensePinAlias)}
runout_gcode:
	_ON_TOOLHEAD_FILAMENT_SENSOR_RUNOUT TOOLHEAD=${th.getTool()}
insert_gcode:
	_ON_TOOLHEAD_FILAMENT_SENSOR_INSERT TOOLHEAD=${th.getTool()}
  
[gcode_button filament_sensor_button${th.printerHasMultipleToolheads ? `_${th.getShortToolName()}` : ''}]
pin: ^${th.getPinPrefix()}${th.getPinFromAlias(sensor.buttonPinAlias)}
press_gcode:
    {% if (printer.print_stats.state == "printing") %}
        _ON_TOOLHEAD_FILAMENT_SENSOR_CLOG TOOLHEAD=${th.getTool()}
    {% else %}
        _ON_FILAMENT_SENSOR_BUTTON_PRESSED TOOLHEAD=${th.getTool()}
    {% endif %}
release_gcode:
	# No action on release
`;
};
