"use strict";exports.id=909,exports.ids=[909],exports.modules={40909:(e,t,n)=>{n.r(t),n.d(t,{getRequiredPinAliases:()=>getRequiredPinAliases,renderTemplate:()=>renderTemplate});var i=n(38316);let o=i.z.object({invertRunoutPin:i.z.boolean().default(!1),pullUpRunoutPin:i.z.boolean().default(!0)}),getRequiredPinAliases=e=>["filament_sensor_runout_pin"],renderTemplate=e=>{let t=e.th,n=o.parse(e.templateOptions??{});return`
[filament_switch_sensor filament_sensor${t.printerHasMultipleToolheads?`_${t.getShortToolName()}`:""}]
pause_on_runout: False
event_delay: 1.0
switch_pin: ${n.invertRunoutPin?"!":""}${n.pullUpRunoutPin?"^":""}${t.getPinPrefix()}${t.getPinFromAlias("filament_sensor_runout_pin")}
runout_gcode:
	_ON_TOOLHEAD_FILAMENT_SENSOR_RUNOUT TOOLHEAD=${t.getTool()}
insert_gcode:
	_ON_TOOLHEAD_FILAMENT_SENSOR_INSERT TOOLHEAD=${t.getTool()}
`}}};