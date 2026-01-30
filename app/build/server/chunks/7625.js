"use strict";exports.id=7625,exports.ids=[7625],exports.modules={7377:(e,r,i)=>{i.r(r),i.d(r,{sensorlessXTemplate:()=>sensorlessXTemplate,sensorlessYTemplate:()=>sensorlessYTemplate});var o=i(54656);let sensorlessXTemplate=(e,r,i)=>`
# Sensorless homing.
#
# Tune the sensorless_x_current variable and the SGTHRS/SGT value in this file untill you get reliable homing.
# Beware of false instant triggering which can make it look like the homing procedure is skipping an axis, when in fact it's not.
# This is especially true for the Y axis on CoreXY machines.
#
# Read the klipper documentation for more info: https://www.klipper3d.org/TMC_Drivers.html#sensorless-homing
#
# Note: if your board has diag jumpers, you would need to insert them for the specific drivers you want to use for sensorless homing on.
# Note: Sensorless homing does NOT work if you drivers have a missing DIAG pins.    
# Check https://www.klipper3d.org/TMC_Drivers.html#sensorless-homing for tuning instructions.

[${r.getAxisDriverSectionName(o.po.x)}]
${r.getAxisDriverDiagConfig(o.po.x)}
${i?"# Printer has a pretuned sensorless homing config, uncomment the next line to override it":""}
${i?"#":""}${r.getAxisDriverStallGuardThreshold(o.po.x,.5)}

[${r.getAxisStepperName(o.po.x)}]
endstop_pin: ${r.getAxisVirtualEndstop(o.po.x)}
homing_retract_dist: 0

[gcode_macro RatOS]
variable_homing_x: "sensorless"
${i?"# Printer has a pretuned sensorless homing config, uncomment the next line to override it":""}
${i?"#":""}variable_sensorless_x_current: ${r.getAxisDriverHomingCurrent(o.po.x,.35)}
`,sensorlessYTemplate=(e,r,i)=>`
# Sensorless homing.
#
# Tune the current variable and the SGTHRS value in the included file(s) untill you get reliable homing.
# Beware of false instant triggering which can make it look like the homing procedure is skipping an axis, when in fact it's not.
# This is especially true for the Y axis on CoreXY machines.
#
# Read the klipper documentation for more info: https://www.klipper3d.org/TMC_Drivers.html#sensorless-homing
#
# Note: if your board has diag jumpers, you would need to insert them for the specific drivers you want to use for sensorless homing on.
# Note: Sensorless homing does NOT work if you drivers have a missing DIAG pins.
# Check https://www.klipper3d.org/TMC_Drivers.html#sensorless-homing for tuning instructions.

[${r.getAxisDriverSectionName(o.po.y)}]
${r.getAxisDriverDiagConfig(o.po.y)}
${i?"# Printer has a pretuned sensorless homing config, uncomment the next line to override it":""}
${i?"#":""}${r.getAxisDriverStallGuardThreshold(o.po.y,.5)}

[stepper_y]
endstop_pin: ${r.getAxisVirtualEndstop(o.po.y)}
homing_retract_dist: 0

[gcode_macro RatOS]
variable_homing_y: "sensorless"
${i?"# Printer has a pretuned sensorless homing config, uncomment the next line to override it":""}
${i?"#":""}variable_sensorless_y_current: ${r.getAxisDriverHomingCurrent(o.po.y,.51)}
`},54656:(e,r,i)=>{i.d(r,{Ah:()=>v,HB:()=>l,JQ:()=>c,MI:()=>a,P6:()=>h,R_:()=>matchesDefaultRail,g6:()=>x,po:()=>t,r:()=>u,v6:()=>s,vF:()=>m});var o,t,n=i(12051);!function(e){e[e["24V"]=24]="24V",e[e["36V"]=36]="36V",e[e["48V"]=48]="48V",e[e["56V"]=56]="56V",e[e["60V"]=60]="60V"}(o||(o={}));let matchesDefaultRail=(e,r,i)=>e.axis===r.axis&&e.driver.id===r.driver.id&&e.stepper.id===r.stepper.id&&(i&&r.performanceMode&&e.voltage===r.performanceMode?.voltage&&e.current===r.performanceMode?.current||!i&&e.voltage===r.voltage&&e.current===r.current),s=n.jb(o),a=n.Z_(),l=n.Ry({id:a,title:n.Z_(),protocol:n.Km(["SPI","UART"]),coolingCurrentThreshold:n.Rx(),voltages:s.array(),maxCurrent:n.Rx().min(0),external:n.O7().optional()}).and(n.Ry({type:n.Km(["TMC2209","TMC2226","TMC5160","TMC2130"]),senseResistor:n.Rx().min(0)}).or(n.Ry({type:n.Km(["TMC2240"])}))),d=n.Ry({voltage:s,run_current:n.Rx(),driver:a}),p=d.extend({driver_MSLUT0:n.Rx().optional(),driver_MSLUT1:n.Rx().optional(),driver_MSLUT2:n.Rx().optional(),driver_MSLUT3:n.Rx().optional(),driver_MSLUT4:n.Rx().optional(),driver_MSLUT5:n.Rx().optional(),driver_MSLUT6:n.Rx().optional(),driver_MSLUT7:n.Rx().optional(),driver_W0:n.Rx().optional(),driver_W1:n.Rx().optional(),driver_W2:n.Rx().optional(),driver_W3:n.Rx().optional(),driver_X1:n.Rx().optional(),driver_X2:n.Rx().optional(),driver_X3:n.Rx().optional(),driver_START_SIN:n.Rx().optional(),driver_START_SIN90:n.Rx().optional(),driver_IHOLDDELAY:n.Rx().optional(),driver_TPOWERDOWN:n.Rx().optional(),driver_TBL:n.Rx().optional(),driver_TOFF:n.Rx().optional(),driver_HEND:n.Rx().optional(),driver_HSTRT:n.Rx().optional(),driver_PWM_AUTOSCALE:n.O7().optional(),driver_PWM_FREQ:n.Rx().optional(),driver_PWM_GRAD:n.Rx().optional(),driver_PWM_AMPL:n.Rx().optional(),driver_SGT:n.Rx().optional()}),m=n.Ry({id:n.Z_(),title:n.Z_(),fullStepsPerRotation:n.Rx().default(200),maxPeakCurrent:n.Rx().min(0),presets:n.IX(n.VK("driver",[p.extend({driver:n.Km(["TMC2130","TMC5160"]),sense_resistor:n.Rx()}),p.extend({driver:n.Km(["TMC2240"])}),d.extend({driver:n.Km(["TMC2209"]),driver_TBL:n.Rx().optional(),driver_TOFF:n.Rx().optional(),driver_HEND:n.Rx().optional(),driver_HSTRT:n.Rx().optional(),sense_resistor:n.Rx()})])).optional().describe("Stepper presets are tightly coupled to the driver type, sense_resistor, stepper, voltage and current.")});!function(e){e.x="x",e.dual_carriage="dual_carriage",e.x1="x1",e.y="y",e.y1="y1",e.y2="y2",e.z="z",e.z1="z1",e.z2="z2",e.z3="z3",e.extruder="extruder",e.extruder1="extruder1"}(t||(t={}));let x=n.Ry({axis:n.jb(t).describe("Axis of the rail"),axisDescription:n.Z_().optional().describe("Description of the axis"),driver:l.describe("Stepper driver used on this axis"),voltage:s.default(24).describe("Voltage of the stepper driver"),stepper:m.describe("Stepper motor connected to this axis"),invertStepperDirection:n.O7().default(!1).describe("Invert the default direction of the stepper motor"),axisMinimum:n.Rx().optional().describe("Minimum position of the axis in mm"),axisMaximum:n.Rx().optional().describe("Maximum position of the axis in mm"),axisEndstop:n.Rx().optional().describe("Endstop position of the axis in mm"),motorSlot:n.Z_().optional().describe("Optional board motor slot of the stepper driver"),current:n.Rx().min(0),rotationDistance:n.Rx().min(0).describe("Distance in mm the axis travels per stepper rotation"),gearRatio:n.Z_().regex(/^\d+:\d+$/).optional().describe("Optional gear ratio of the axis"),homingSpeed:n.Rx().min(0).default(10).describe("Axis speed during homing in mm/s"),microstepping:n.Rx().min(16).max(256).default(64).describe("Microstepping of the stepper driver, higher values increase resolution and lower noise but increases load on the MCU")}),h=x.extend({motorSlot:n.S1(),performanceMode:n.Ry({current:n.Rx().min(0),voltage:s.default(24).describe("Voltage of the stepper driver in performance mode"),homingSpeed:n.Rx().min(0).optional().describe("Axis speed during homing in mm/s in performance mode")}).optional()}),u=h.extend({driver:a,stepper:m.shape.id}),c=x.refine(e=>e.current<=e.driver.maxCurrent,"Current must be less than max current of the driver"),v=x.extend({driver:a,stepper:m.shape.id});n.Ry({min:n.Rx(),max:n.Rx(),endstop:n.Rx()})}};