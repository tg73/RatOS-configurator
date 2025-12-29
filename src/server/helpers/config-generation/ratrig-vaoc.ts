export type VAOCControlPoints = {
	xcontrolpoint?: number;
	ycontrolpoint?: number;
	zcontrolpoint?: number;
	zoffsetcontrolpoint?: number;
};

export function getDefaultVaocControlPoints(config: { size: { x: number } }): VAOCControlPoints {
	return {
		xcontrolpoint: config.size.x / 2,
		ycontrolpoint: 50,
		zcontrolpoint: 50,
		zoffsetcontrolpoint: 25,
	};
}

export function getVaocControlPointVariables(config: { size: { x: number } }, options?: VAOCControlPoints): string[] {
	options ??= getDefaultVaocControlPoints(config);
	return [
		`idex_xcontrolpoint = ${options.xcontrolpoint}`,
		`idex_ycontrolpoint = ${options.ycontrolpoint}`,
		`idex_zcontrolpoint = ${options.zcontrolpoint}`,
		`idex_zoffsetcontrolpoint = ${options.zoffsetcontrolpoint}`,
		`idex_xoffset = 0.0`,
		`idex_yoffset = 0.0`,
		`idex_zoffset = 0.0`,
	];
}

export function renderVaocResetMacro(config: { size: { x: number } }, options?: VAOCControlPoints): string {
	options ??= getDefaultVaocControlPoints(config);
	return `
[gcode_macro _VAOC_RESET]
gcode:
	DEBUG_ECHO PREFIX="_VAOC_RESET" MSG="running template-emitted _VAOC_RESET macro"

	# ratos variables file
	{% set svv = printer.save_variables.variables %}

	# reset VAOC variables 
	SAVE_VARIABLE VARIABLE=idex_xcontrolpoint VALUE=${options.xcontrolpoint}
	SAVE_VARIABLE VARIABLE=idex_ycontrolpoint VALUE=${options.ycontrolpoint}
	SAVE_VARIABLE VARIABLE=idex_zcontrolpoint VALUE=${options.zcontrolpoint}
	SAVE_VARIABLE VARIABLE=idex_zoffsetcontrolpoint VALUE=${options.zoffsetcontrolpoint}
	SAVE_VARIABLE VARIABLE=idex_xoffset VALUE=0.0
	SAVE_VARIABLE VARIABLE=idex_yoffset VALUE=0.0
	SAVE_VARIABLE VARIABLE=idex_zoffset VALUE=0.0

	RESET_DC_ENDSTOP_CONFIGURATION
	RESET_Y_MAX_ADJUSTMENT

	# echo
	CONSOLE_ECHO TITLE="VAOC Configuration Reset" MSG="VAOC configuration has been reset. You must RESTART klipper for the changes to take effect,_N_then re-calibrate VAOC."
`;
}
