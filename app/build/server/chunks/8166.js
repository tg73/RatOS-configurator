"use strict";exports.id=8166,exports.ids=[8166],exports.modules={18166:(e,t,o)=>{o.d(t,{template:()=>template});let template=e=>{let t=e.getFilamentSensor();if(null==t)throw Error("Filament sensor is not configured");return`
[filament_switch_sensor filament_sensor${e.printerHasMultipleToolheads?`_${e.getShortToolName()}`:""}]
pause_on_runout: False
event_delay: 1.0
switch_pin: ^${e.getPinPrefix()}${e.getPinFromAlias(t.sensePinAlias)}
runout_gcode:
	_ON_TOOLHEAD_FILAMENT_SENSOR_RUNOUT TOOLHEAD=${e.getTool()}
insert_gcode:
	_ON_TOOLHEAD_FILAMENT_SENSOR_INSERT TOOLHEAD=${e.getTool()}
  
[gcode_button filament_sensor_button${e.printerHasMultipleToolheads?`_${e.getShortToolName()}`:""}]
pin: ^${e.getPinPrefix()}${e.getPinFromAlias(t.buttonPinAlias)}
press_gcode:
    {% if (printer.print_stats.state == "printing") %}
        _ON_TOOLHEAD_FILAMENT_SENSOR_CLOG TOOLHEAD=${e.getTool()}
    {% else %}
        _ON_FILAMENT_SENSOR_BUTTON_PRESSED TOOLHEAD=${e.getTool()}
    {% endif %}
release_gcode:
	# No action on release
`}}};