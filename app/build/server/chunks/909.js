"use strict";exports.id=909,exports.ids=[909],exports.modules={40909:(e,t,n)=>{n.d(t,{template:()=>template});var o=n(38316);let l=o.z.object({invertSensePin:o.z.boolean().default(!1),invertButtonPin:o.z.boolean().default(!1),pullUpSensePin:o.z.boolean().default(!0),pullUpButtonPin:o.z.boolean().default(!0)}),template=e=>{let t=e.getFilamentSensor();if(null==t)throw Error("Filament sensor is not configured");let n=l.parse(t.templateProperties??{}),o=`
[filament_switch_sensor filament_sensor${e.printerHasMultipleToolheads?`_${e.getShortToolName()}`:""}]
pause_on_runout: False
event_delay: 1.0
switch_pin: ${n.invertSensePin?"!":""}${n.pullUpSensePin?"^":""}${e.getPinPrefix()}${e.getPinFromAlias(t.sensePinAlias)}
runout_gcode:
	_ON_TOOLHEAD_FILAMENT_SENSOR_RUNOUT TOOLHEAD=${e.getTool()}
insert_gcode:
	_ON_TOOLHEAD_FILAMENT_SENSOR_INSERT TOOLHEAD=${e.getTool()}
`;if(!t.hasButton)return o;{let l=`
[gcode_button filament_sensor_button${e.printerHasMultipleToolheads?`_${e.getShortToolName()}`:""}]
pin: ${n.invertButtonPin?"!":""}${n.pullUpButtonPin?"^":""}${e.getPinPrefix()}${e.getPinFromAlias(t.buttonPinAlias)}
press_gcode:
	_ON_FILAMENT_SENSOR_BUTTON_PRESSED TOOLHEAD=${e.getTool()}
release_gcode:
	# No action on release
`;return o+l}}}};