export type VAOCControlPoints = {
	xcontrolpoint?: number;
	ycontrolpoint?: number;
	zcontrolpoint?: number;
	zoffsetcontrolpoint?: number;
};

export function getVaocControlPointVariables(config: { size: { x: number } }, options?: VAOCControlPoints): string[] {
	return [
		`idex_applied_offset = 1`,
		`idex_xcontrolpoint = ${options?.xcontrolpoint ?? config.size.x / 2}`,
		`idex_xoffset = 0.0`,
		`idex_ycontrolpoint = ${options?.ycontrolpoint ?? 50}`,
		`idex_yoffset = 0.0`,
		`idex_zcontrolpoint = ${options?.zcontrolpoint ?? 50}`,
		`idex_zoffset = 0.0`,
		`idex_zoffsetcontrolpoint = ${options?.zoffsetcontrolpoint ?? 25}`,
	];
}
