"use strict";exports.id=5477,exports.ids=[5477],exports.modules={5477:(e,t,o)=>{o.r(t),o.d(t,{getRequiredPinAliases:()=>getRequiredPinAliases,renderTemplate:()=>renderTemplate});var n=o(38316);let i=n.z.object({isSmart:n.z.boolean().default(!1)}),getRequiredPinAliases=e=>["filament_sensor_runout_pin","filament_sensor_motion_pin"],renderTemplate=e=>{let t=e.toolheadGenerator,o=i.parse(e.templateOptions??{}),n=`
[filament_switch_sensor filament_sensor${t.printerHasMultipleToolheads?`_${t.getShortToolName()}`:""}]
pause_on_runout: False
event_delay: 1.0
switch_pin: ^${t.getPinPrefix()}${t.getPinFromAlias("filament_sensor_runout_pin")}
runout_gcode:
	_ON_TOOLHEAD_FILAMENT_SENSOR_RUNOUT TOOLHEAD=${t.getTool()}
insert_gcode:
	_ON_TOOLHEAD_FILAMENT_SENSOR_INSERT TOOLHEAD=${t.getTool()}
`,_=o.isSmart?`
[gcode_button filament_sensor_button${t.printerHasMultipleToolheads?`_${t.getShortToolName()}`:""}]
pin: ^${t.getPinPrefix()}${t.getPinFromAlias("filament_sensor_motion_pin")}
press_gcode:
    {% if (printer.print_stats.state == "printing") %}
        _ON_TOOLHEAD_FILAMENT_SENSOR_CLOG TOOLHEAD=${t.getTool()}
    {% else %}
        _ON_FILAMENT_SENSOR_BUTTON_PRESSED TOOLHEAD=${t.getTool()}
    {% endif %}
release_gcode:
	# No action on release
`:`
[gcode_button filament_sensor_button${t.printerHasMultipleToolheads?`_${t.getShortToolName()}`:""}]
pin: ^${t.getPinPrefix()}${t.getPinFromAlias("filament_sensor_motion_pin")}
press_gcode:
	_ON_FILAMENT_SENSOR_BUTTON_PRESSED TOOLHEAD=${t.getTool()}
release_gcode:
	# No action on release
`;return n+_}}};