# Enhancements and utilities for printers with a dual carriage axis
#
# Copyright (C) 2026 Tom Glastonbury <t@tg73.net>
#
# This file may be distributed under the terms of the GNU GPLv3 license.

import logging
import numpy as np
from .homing import HomingMove
from collections import namedtuple

INACTIVE = 'INACTIVE'
PRIMARY = 'PRIMARY'
COPY = 'COPY'
MIRROR = 'MIRROR'

ToolheadCorrectionCoefficients = namedtuple('ToolheadCorrectionCoefficients', ['m', 'c',])

class DualCarriageToolbox:
	def __init__(self, config):
		self.name = config.get_name()
		self.printer = config.get_printer()

		if not config.has_section("dual_carriage"):
			logging.info(f"{self.name}: configuration section [dual_carriage] not found, {self.name} will not be initialized.")
			return

		self.allow_suspicous_transform_chain_order = config.getboolean('allow_suspicious_transform_chain_order', False)
		self.max_x_correction = config.getfloat('max_x_correction', 1.0, minval=0.1)

		self.gcode = self.printer.lookup_object('gcode')
		self.gcode_move = self.printer.lookup_object('gcode_move')
		self.ratos = self.printer.lookup_object('ratos')
		
		self.next_transform = None
		self.dual_carriage = None
		self.dc_axis_index = None
		self.dc_axis_name = None
		self._original_set_dual_carriage_cmd = None
		self._original_restore_dual_carriage_state_cmd = None
		self.dc_correction_enabled = False
		self._dc_active_toolhead = None
		self._correction_coefficients = None

		self.printer.register_event_handler("klippy:connect", self._connect)

		self.printer.register_event_handler("stepper_enable:motor_off",
											self._handle_motor_off)

		# NB: chain the transform here rather than in connect as this makes config section ordering easier to manage.
		# [bed_mesh] also does this, but for example [skew_correction] registers in connect. So [dual_carriage_toolbox]
		# just needs to be declared after [bed_mesh] (if bed_mesh is used).		
		self._chain_gcode_move_transform()

	def _chain_gcode_move_transform(self):
		self.next_transform = self.gcode_move.set_move_transform(self, force=True)

		# Check class name of next_transform to check for sensible chain order
		next_transform_class = self.next_transform.__class__.__name__
		
		# Our transformation needs to work with the untransformed toolhead y position. So we check the transform order.
		# [bed_mesh] and [bed_tilt] both demand to be the first transform in the chain (ie, right next to toolhead),
		# and they do not modify x or y.
		if next_transform_class not in ('BedMesh', 'BedTilt', 'ToolHead'):
			is_known_bad = next_transform_class in ('PrinterSkew',)
			transform_name = getattr(self.next_transform, 'name', None)
			if self.allow_suspicous_transform_chain_order and not is_known_bad:
				logging.warning(
					f"{self.name}: unexpected transform chain order permitted because allow_suspicious_transform_chain_order=True: [{self.name}] should be declared before the module with class {next_transform_class}"
					f"{f' (probably [{transform_name}])' if isinstance(transform_name, str) else ''} in printer.cfg.")
			else:
				raise self.printer.config_error(
					f"{self.name}: unexpected transform chain order: [{self.name}] {'must' if is_known_bad else 'should'} be declared before the module with class {next_transform_class}"
					f"{f' (probably [{transform_name}])' if isinstance(transform_name, str) else ''} in printer.cfg."
					f"{' Use allow_suspicious_transform_chain_order=True to permit this if you understand the implications and want to proceed anyway.' if not is_known_bad else ''}")

	def _connect(self):
		self.dual_carriage = self.printer.lookup_object("dual_carriage", None)
		self.dc_axis_index = self.dual_carriage.axis
		self.dc_axis_name = {0: 'x', 1: 'y'}[self.dual_carriage.axis]


		self._original_set_dual_carriage_cmd = self._override_command('SET_DUAL_CARRIAGE', self.override_SET_DUAL_CARRIAGE, desc_suffix=self.desc_suffix_SET_DUAL_CARRIAGE)
		self._original_restore_dual_carriage_state_cmd = self._override_command('RESTORE_DUAL_CARRIAGE_STATE', self.override_RESTORE_DUAL_CARRIAGE_STATE)
		self.gcode.register_command('_ALIGN_TO_KINEMATIC_POSITION', self.cmd_ALIGN_TO_KINEMATIC_POSITION)
		self.gcode.register_command('MEASURE_DC_ENDSTOP_POSITIONS', self.cmd_MEASURE_DC_ENDSTOP_POSITIONS)
		self.gcode.register_command('ENABLE_DC_ENDSTOP_CORRECTION', self.cmd_ENABLE_DC_ENDSTOP_CORRECTION)
		self.gcode.register_command('DISABLE_DC_ENDSTOP_CORRECTION', self.cmd_DISABLE_DC_ENDSTOP_CORRECTION)

	def _handle_motor_off(self, print_time):
		self._dc_active_toolhead = None
		self._correction_coefficients = None
	
	def _override_command(self, cmd_name, new_cmd, *, when_not_ready:bool=False, desc:str=None, desc_suffix:str=None):
		if desc is None:
			desc = self.gcode.get_command_help().get(cmd_name, None)

		if desc_suffix is not None:
			if desc is None:
				desc = desc_suffix
			else:
				if not desc.endswith('.'):
					desc = desc + '.'
				desc = desc + ' ' + desc_suffix

		is_base_handler = self.gcode.base_gcode_handlers.get(cmd_name, None) is not None
		
		if is_base_handler != when_not_ready:
			raise self.printer.config_error(f"{cmd_name} is {'' if is_base_handler else 'not '}a base (aka 'when-not-ready') gcode handler, this is not expected. {self.name} cannot be enabled.")
		
		original_cmd = self.gcode.register_command(cmd_name, None)
		
		if original_cmd is None:
			raise self.printer.config_error(f"An existing {cmd_name} command is not registered, {self.name} cannot be enabled. Make sure that [beacon] is declared before [{self.name}] in printer.cfg.")

		self.gcode.register_command(cmd_name, new_cmd, when_not_ready=when_not_ready, desc=desc)
		return original_cmd

	desc_suffix_SET_DUAL_CARRIAGE = "Enhanced by RatOS to first align toolhead to kinematic position, to prevent potential positional drift due to sub-microstep rounding behaviours. Use SKIP_ALIGN=1 to skip the alignment if desired."
	def override_SET_DUAL_CARRIAGE(self, gcmd):
		skip_align = gcmd.get('SKIP_ALIGN', '').lower() in ('true', 'yes', '1')
		if not skip_align:
			self._align_to_kinematic_position(self.dc_axis_name)
		self._original_set_dual_carriage_cmd(gcmd)
		self._update_active_toolhead_for_correction()

	def override_RESTORE_DUAL_CARRIAGE_STATE(self, gcmd):
		self._original_restore_dual_carriage_state_cmd(gcmd)
		self._update_active_toolhead_for_correction()

	def cmd_ALIGN_TO_KINEMATIC_POSITION(self, gcmd):
		axis_name = gcmd.get('AXIS').lower()
		self._align_to_kinematic_position(axis_name)

	def _align_to_kinematic_position(self, axis_name):
		"""
		Align toolhead to kinematic position on the specified axis, if the discrepancy is within a reasonable threshold.
		
		Parameters:
			axis_name (str): The axis to align, one of 'x', 'y', or 'z' (case-insensitive).		
		"""
		# This is intended to correct sub-microstep offsets that can arise between the toolhead position
		# and the kinematic position. Such offsets can result in positional drift when changing dual carriage modes,
		# typically of one microstep distance per cycle of mode changes (eg, T0->T1->T0) - the MCU step count
		# drifts while the calculated kinematic position does not. This drift does not always happen: it
		# appears to depend on some discrepancy in rounding at different layers of the motion system that is not
		# fully round-tripable.
		#
		# The simple safety rule is: don't change dual carriage mode when the toolhead position is not at a
		# microstep boundary on the dual carriage axis (typically the X axis).
		axis_name_upper = axis_name.upper()
		if len(axis_name) != 1 or axis_name not in 'xyz':
			raise self.gcode.error(f"Invalid axis_name: '{axis_name}'. Must be one of x, y, or z.")
		axis_index = 'xyz'.index(axis_name)

		toolhead = self.printer.lookup_object('toolhead')
		toolhead.flush_step_generation()
		kin = toolhead.get_kinematics()
		steppers = kin.get_steppers()

		stepper_positions_list = [(s.get_name(), s.get_commanded_position()) for s in steppers]
		stepper_positions = dict(stepper_positions_list)
		kin_pos = kin.calc_position(stepper_positions)

		toolhead_pos = toolhead.get_position()
		
		kin_ap = kin_pos[axis_index]
		toolhead_ap = toolhead_pos[axis_index]
		delta = abs(kin_ap - toolhead_ap)
		
		if delta < 1e-9:
			logging.debug(f"{self.name}: _align_to_kinematic_position: toolhead is already aligned to kinematic position on axis {axis_name_upper} (delta {delta:.6f}), no action needed.")
			return

		# Note that *by definition*, after flush_step_generation(), the kinematic and toolhead positions
		# should not differ by more than half a microstep. We perform a belt and braces sanity check out of
		# an abundance of caution, and to provide a more informative message if the positions appear
		# significantly misaligned.
		#
		# Determine the minimum change in kinematic position on the specified axis that could result
		# in a change in commanded stepper position any of the steppers that affect this axis. We will
		# not perform a move if the discrepancy is larger than this, as a) it would cause an actual
		# physical move; and b) this is not an expected scenario and indicates a misunderstanding or
		# fault state that should be investigated rather than automatically corrected.
		#
		# We simulate moves in both directions for each stepper, as the cartesian result may differ
		# for non-linear kinematics.
		max_no_stepper_move_distance = None
		for stepper in steppers:
			name = stepper.get_name()
			step_dist = stepper.get_step_dist()
			
			# Check the forward step (+1)
			steppers_forward = dict(stepper_positions)
			steppers_forward[name] += step_dist
			kin_forward = kin.calc_position(steppers_forward)
			one_step_shift_forward = abs(kin_forward[axis_index] - kin_pos[axis_index])
			
			# Check the backward step (-1)
			steppers_backward = dict(stepper_positions)
			steppers_backward[name] -= step_dist
			kin_backward = kin.calc_position(steppers_backward)
			one_step_shift_backward = abs(kin_backward[axis_index] - kin_pos[axis_index])
			
			min_step_shift = min(one_step_shift_forward, one_step_shift_backward)

			# min_step_shift will be zero for inactive steppers (eg, the inactive carriage in dual carriage),
			# ignore those as they do not affect the position on this axis.
			if min_step_shift < 1e-9:
				continue

			if max_no_stepper_move_distance is None or min_step_shift < max_no_stepper_move_distance:
				max_no_stepper_move_distance = min_step_shift

		if max_no_stepper_move_distance is None:
			# This should not happen, as there should be at least one stepper affecting each axis, but we check just in case.
			# Note: we don't raise an error here because we don't want to cause a failure in this command if the kinematics are in some unexpected state; we just won't perform the alignment.
			logging.error(f"{self.name}: _align_to_kinematic_position: could not determine the minimum stepper move distance for {axis_name_upper} axis: no steppers found affecting this axis.")
			return
		
		# floating point boundary allowance
		max_no_stepper_move_distance += 1e-7
		
		curtime = self.printer.get_reactor().monotonic()
		is_homed = axis_name in kin.get_status(curtime)['homed_axes']
		is_sensible = delta <= max_no_stepper_move_distance

		if not is_sensible:
			logging.error(
				f"{self.name}: _align_to_kinematic_position: divergence between toolhead position and kinematic {axis_name_upper} position exceeds safe threshold of {max_no_stepper_move_distance:.9f}:\n"
				f"kinematic: {kin_ap:.6f}, toolhead: {toolhead_ap:.6f}, delta: {delta:.9f}\n"
				"Alignment skipped to avoid unexpected physical move.")
		elif not is_homed:
			logging.debug(f"{self.name}: _align_to_kinematic_position: {axis_name_upper} axis is not homed; skipping alignment")
		else:
			logging.info(f"{self.name}: _align_to_kinematic_position: aligning toolhead to kinematic position for {axis_name_upper} axis: {toolhead_ap:.6f} -> {kin_ap:.6f} (delta {delta:.6f}, safe threshold {max_no_stepper_move_distance:.6f})")
			pos = [None] * 4
			pos[axis_index] = kin_pos[axis_index]
			toolhead.manual_move(pos, 100.)

	def cmd_MEASURE_DC_ENDSTOP_POSITIONS(self, gcmd):
		runs = gcmd.get_int('RUNS', 3, minval=1)
		printable_x_max, printable_y_max = self.ratos.get_printable_max_dimensions()
		travel_speed = float(self.ratos.gm_ratos.variables['macro_travel_speed'])
		toolhead = self.printer.lookup_object('toolhead')
		
		self.gcode.run_script_from_command(f"MAYBE_HOME\n_Z_HOP")
		
		# oa means other_axis
		oa_index = 1 if self.dc_axis_index == 0 else 0
		oa_printable_max = printable_y_max if oa_index == 1 else printable_x_max
		oa_positions = (0., round(oa_printable_max / 2., 1), oa_printable_max)

		raw_data = []

		for _ in range(runs):
			for oa_pos in oa_positions:
				pos = [None] * 4
				pos[oa_index] = oa_pos
				toolhead.manual_move(pos, travel_speed)
				raw_data.append(self._measure_dc_endstop_positions())

		# 1. Convert to NumPy array
		# 2. Reshape to (runs, num_positions, 2_endstops)
		data = np.array(raw_data).reshape(runs, len(oa_positions), 2)		
		
		# Calculate stats across axis 0 (the 'runs' dimension)
		means = np.mean(data, axis=0)
		stds = np.std(data, axis=0)

		distances = means[:, 1] - means[:, 0]

		lines = []

		# Define column headers
		col_oa = 'XY'[oa_index]
		col_m0 = 'front' if self.dc_axis_index != 0 else 'left'
		col_m1 = 'back' if self.dc_axis_index != 0 else 'right'

		# Header logic: Position | Mean 0 | Distance | Mean 1 | SD 0 | SD 1
		header = (
			f"| {col_oa:>3} | {col_m0:^9} | {'dist':^9} | {col_m1:^9} | {(col_m0+' sd'):^8} | {(col_m1+' sd'):^8} |"
		)
		lines.append(header)
		lines.append("-" * len(header))

		for i, oa_pos in reversed(list(enumerate(oa_positions))):
			# Data Columns:
			# 0: oa_pos (3.0f)
			# 1: Mean 0 (8.2f)
			# 2: Distance (8.2f)
			# 3: Mean 1 (8.2f)
			# 4: SD 0 (8.3f)
			# 5: SD 1 (8.3f)
			line = (
				f"| {oa_pos:>3.0f} | "
				f"{means[i, 0]:>9.2f} | "
				f"{distances[i]:>9.2f} | "
				f"{means[i, 1]:>9.2f} | "
				f"{stds[i, 0]:>8.3f} | "
				f"{stds[i, 1]:>8.3f} |"
			)
			lines.append(line)

		table = "\n".join(lines)
		shape = self._generate_dc_endstops_ascii_shape(means, oa_positions)
		gcmd.respond_info(f"Dual carriage endstop positions (in mm) across {runs} runs:\n\n{table}\n\n{shape}")

		# TODO: Generalize correction for X or Y DC axis (currently hardcoded for X)

# Dual carriage endstop positions (in mm) across 3 runs:

# |   Y |   left    |   dist    |   right   | left sd  | right sd |
# -----------------------------------------------------------------
# |   0 |    -59.60 |    419.82 |    360.22 |    0.006 |    0.010 |
# | 150 |    -59.59 |    419.75 |    360.16 |    0.000 |    0.006 |
# | 300 |    -59.56 |    419.64 |    360.08 |    0.006 |    0.006 |


# if we measure -58.0 would require a +ve x offset (+1.6) to correct.
# ==================================================
# GEOMETRY: Taper:High | Skew:Low
# ==================================================
# |                 2================H  [oa_printable_max] W:419.636
# |                 /                \
# |                 /                 \
# |                 /                 \
# |                /                  \
# |                H==================H  [MID] W:419.749
# |                |                   \
# |                |                   \
# |                |                   \
# |                |                    \
# |                0====================H  [ 0 ] W:419.815

		# Update correction coefficients based on the measurements, using a simple linear model. We only
		# consider the corner positions for this - which results in a linear model for T0 using the front and 
		# back left measurements, and a linear model for T1 using the front and back right measurements.
		# A non-linear model cannot be used as this would require move splitting in the same way as bed mesh
		# compensation, which would significantly increase the complexity of the implementation.
		correction_coefficients = []
		for tool_index in range(2):
			rail = self.dual_carriage.get_rails()[tool_index].get_rail()
			hi = rail.get_homing_info()
			expected_endstop_position = hi.position_endstop

			# means indexing: 0 for front or left, 1 for middle, 2 for back or right
			# the correction produces an offset in dc_axis (typically X) that corrects the measured endstop position
			# to match expected_endstop_position at the front and back positions, and interpolates linearly in between.
			m = (expected_endstop_position - means[2, tool_index] - (expected_endstop_position - means[0, tool_index])) / oa_printable_max
			c = expected_endstop_position - means[0, tool_index]
			correction_coefficients.append(ToolheadCorrectionCoefficients(m=m, c=c))

		gcmd.respond_info(f"Updated correction coefficients: {correction_coefficients}")
		self._correction_coefficients = correction_coefficients

	def _generate_dc_endstops_ascii_shape(self, means, oa_positions, num_lines=11, plot_width=40):
		# Calculate physical values
		widths = means[:, 1] - means[:, 0]
		offsets = means[:, 0] - means[0, 0]
		
		# Quantitative deltas
		taper_val = widths[2] - widths[0]
		skew_val = offsets[2] - offsets[0]
		mid_bow = (widths[1] - (widths[0] + widths[2]) / 2.0)

		def get_desc(val):
			abs_val = abs(val)
			if abs_val <= 0.02: return "None"
			if abs_val <= 0.05: return "Low"
			if abs_val <= 0.1:  return "Med"
			if abs_val <= 0.2:  return "High"
			return "Severe"

		# --- Scaling Logic ---
		# We want 0.2mm (severe) to result in a visual shift of ~5 characters
		# to make the error obvious without breaking the screen.
		visual_scale = 25
		base_padding = 15
		poly_base_width = plot_width // 2 # The "square" part of the box

		def get_char(start, end):
			diff = end - start
			if abs(diff) < 0.01: return "|"
			return "/" if diff > 0 else "\\"

		lines = []
		lines.append("")
		lines.append(f"Taper: {get_desc(taper_val)} ({taper_val:.2f}) | Skew: {get_desc(skew_val)} ({skew_val:.2f}) | Mid Bow: {get_desc(mid_bow)} ({mid_bow:.2f})")
		lines.append("")

		for i in range(num_lines):
			t = (num_lines - 1 - i) / (num_lines - 1)
			
			if t <= 0.5:
				idx_low, idx_high = 0, 1
				seg_t = t * 2.0
			else:
				idx_low, idx_high = 1, 2
				seg_t = (t - 0.5) * 2.0
			
			# Interpolate deltas
			curr_off_mm = offsets[idx_low] + (offsets[idx_high] - offsets[idx_low]) * seg_t
			curr_wid_delta_mm = (widths[idx_low] - widths[0]) + ((widths[idx_high] - widths[idx_low]) * seg_t)
			
			# Use round() instead of int() to prevent "jitter"
			l_pos = int(round(base_padding + (curr_off_mm * visual_scale)))
			w_pos = int(round(poly_base_width + (curr_wid_delta_mm * visual_scale)))
			w_pos = max(5, min(w_pos, plot_width))

			char_l = get_char(offsets[idx_low], offsets[idx_high])
			char_r = get_char(offsets[idx_low] + widths[idx_low], offsets[idx_high] + widths[idx_high])
			
			fill_char = " "
			if i == 0 or i == (num_lines // 2) or i == (num_lines - 1):
				char_l = char_r = "H"
				fill_char = "="

			# Construct line with the console-safe prefix
			line_content = " " * l_pos + char_l + fill_char * w_pos + char_r
			
			# Labels
			if i == 0:               line_content += f"  {oa_positions[2]:.0f} w={widths[2]:.3f}"
			if i == (num_lines // 2): line_content += f"  {oa_positions[1]:.0f} w={widths[1]:.3f}"
			if i == (num_lines - 1):  line_content += f"  {oa_positions[0]:.0f} w={widths[0]:.3f}"
			
			lines.append("| " + line_content)

		return "\n".join(lines)
	
	def _measure_dc_endstop_positions(self):
		if self.dual_carriage is None:
			raise self.printer.command_error("This command is only supported on IDEX printers")
		
		travel_speed = float(self.ratos.gm_ratos.variables['macro_travel_speed'])

		toolhead = self.printer.lookup_object('toolhead')
		toolhead.flush_step_generation()
		kin = toolhead.get_kinematics()
		curtime = self.printer.get_reactor().monotonic()

		if self.dc_axis_name not in kin.get_status(curtime)['homed_axes']:
			raise self.printer.command_error(f"Must home dual carriage axis ({self.dc_axis_name.upper()}) before measuring endstop positions")
		
		if self.dual_carriage.get_rails()[1].mode in (COPY, MIRROR):
			raise self.printer.command_error(f"Must be in IDEX_SINGLE mode to measure endstop positions, {self.dual_carriage.get_rails()[1].mode} mode is not allowed")

		results = []

		min_retract_distance = 3.0
		allow_overshoot = 1.0

		for tool in (0, 1):
			self.gcode.run_script_from_command(f"T{tool} S=0")
			toolhead.flush_step_generation()
			rail = self.dual_carriage.get_primary_rail().get_rail()
			hi = rail.get_homing_info()
			retract_distance = max(min_retract_distance, hi.retract_dist)
			# Rapidly move to close to the endstop
			pos = [None] * 4
			pos[self.dc_axis_index] = hi.position_endstop + (-retract_distance if hi.positive_dir else +retract_distance)
			toolhead.manual_move(pos, travel_speed)
			toolhead.flush_step_generation()
			# Force-set the toolhead position to allow the homing move to physically go beyond
			# the declared endstop position
			start_pos = toolhead.get_position()
			force_pos = start_pos[:]
			force_pos[self.dc_axis_index] += -allow_overshoot if hi.positive_dir else +allow_overshoot
			toolhead.set_position(force_pos)
			try:
				move_end_pos = start_pos[:]
				move_end_pos[self.dc_axis_index] = hi.position_endstop
				hmove = HomingMove(self.printer, rail.get_endstops())
				try:
					epos = hmove.homing_move(move_end_pos, hi.second_homing_speed, probe_pos=True)
				except self.printer.command_error:
					if self.printer.is_shutdown():
						raise self.printer.command_error(
							"Measurement failed due to printer shutdown")
					raise
				results.append(epos[self.dc_axis_index] + (+allow_overshoot if hi.positive_dir else -allow_overshoot))
			finally:
				# Restore the toolhead position after the homing move, and leave it at the retract position
				toolhead.manual_move(force_pos, travel_speed)
				toolhead.set_position(start_pos)

		# Return to T0 after measurement
		self.gcode.run_script_from_command(f"T0 S=0")

		return results

	def cmd_ENABLE_DC_ENDSTOP_CORRECTION(self, gcmd):
		self.enable_dc_endstop_correction()

	def cmd_DISABLE_DC_ENDSTOP_CORRECTION(self, gcmd):
		self.disable_dc_endstop_correction()

	def enable_dc_endstop_correction(self):
		if self.dc_correction_enabled:
			return
		if self._correction_coefficients is None:
			raise self.printer.command_error("No dual carriage measurement data available to apply correction. Please run MEASURE_DC_ENDSTOP_POSITIONS command first.")
		self.dc_correction_enabled = True
		self.gcode_move.reset_last_position()

	def disable_dc_endstop_correction(self):
		if not self.dc_correction_enabled:
			return
		self.dc_correction_enabled = False
		self.gcode_move.reset_last_position()

	def _update_active_toolhead_for_correction(self):
		self._dc_active_toolhead = None
		for index, rail in enumerate(self.dual_carriage.get_rails()):
			if rail.mode == PRIMARY:
				self._dc_active_toolhead = index
			elif rail.mode in (COPY, MIRROR):
				# disable correction in copy and mirror modes
				self._dc_active_toolhead = None
				return

	def _get_x_offset_for_active_toolhead(self, y:float):
		if not self.dc_correction_enabled or self._dc_active_toolhead is None or self._correction_coefficients is None:
			return 0.
		coeffs = self._correction_coefficients[self._dc_active_toolhead]
		offset = coeffs.m * y + coeffs.c
		clamped = max(min(offset, self.max_x_correction), -self.max_x_correction)
		if clamped != offset:
			# TODO: remove before production, maybe replace with rate-limited logging
			self.gcode.respond_info(f"{self.name}: calculated x offset of {offset:.3f} for T{self._dc_active_toolhead} at y={y:.3f} clamped to {clamped:.3f}")
		else:
			# TODO: development logging, remove before production
			self.gcode.respond_info(f"T{self._dc_active_toolhead} {offset:.3f} @ {y:.3f}")
		return clamped
	
	######
	# gcode_move transform compliance
	######
	def get_position(self):
		# TODO: Generalize correction for X or Y DC axis (currently hardcoded for X)
		# Remove correction
		pos = self.next_transform.get_position()[:]
		offset = self._get_x_offset_for_active_toolhead(pos[1])
		pos[0] -= offset
		return pos

	def move(self, newpos, speed):
		# TODO: Generalize correction for X or Y DC axis (currently hardcoded for X)
		# Apply correction
		offset = self._get_x_offset_for_active_toolhead(newpos[1])
		pos = newpos[:]
		pos[0] += offset
		self.next_transform.move(pos, speed)
#####
# Loader
#####
def load_config(config):
	return DualCarriageToolbox(config)
